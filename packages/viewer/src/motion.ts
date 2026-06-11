import {
  AnimationClip,
  Matrix4,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack
} from "three";
import type { AssemblyStep, Motion, Quat, Vec3 } from "./types";

/**
 * Pure keyframe construction for step motions. No WebGL — everything here is
 * unit-testable in node.
 *
 * Motion JSON describes the INSERTION of a part: keyframes start at the
 * displaced (pre-insertion) pose and end at the part's final (seated) pose.
 * All poses produced by `motionToKeyframes` are world-space; `buildStepClip`
 * converts them into each node's parent-local space for animation.
 */

/** A world-space pose: position + quaternion ([x, y, z, w]) */
export type Pose = {
  position: Vec3;
  quaternion: Quat;
};

export type MotionKeyframes = {
  /** Seconds, monotonically non-decreasing, starting at 0 */
  times: number[];
  /** Flat [x, y, z] per keyframe, world space */
  positions: number[];
  /** Flat [x, y, z, w] per keyframe, world space */
  quaternions: number[];
};

export type MotionKeyframeOptions = {
  /** Total animation duration in seconds. Defaults to `motionDuration(motion)`. */
  duration?: number;
  /** Helix sampling density (quaternion slerp needs <180° between samples). */
  samplesPerTurn?: number;
};

export type StepClipOptions = MotionKeyframeOptions & {
  /** Seconds to hold the seated pose at the end of each loop. */
  holdSeconds?: number;
};

const INSERTION_SPEED_MM_PER_S = 60;
const MIN_DURATION_S = 1;
const MAX_DURATION_S = 4;
const DEFAULT_SAMPLES_PER_TURN = 4;
export const DEFAULT_HOLD_SECONDS = 0.6;
/** Timeline length of a process-only (none-motion) step without an explicit duration */
const NONE_STEP_SECONDS = 2;

/**
 * Seconds a step occupies on the continuous timeline: the explicit
 * `durationSeconds` override when set, otherwise the natural animation
 * length (motion duration + seated hold), or a fixed slot for process-only
 * steps.
 */
export function stepTimelineSeconds(
  step: Pick<AssemblyStep, "motion" | "durationSeconds">
): number {
  if (step.durationSeconds && step.durationSeconds > 0) {
    return step.durationSeconds;
  }
  if (step.motion.type === "none") return NONE_STEP_SECONDS;
  return motionDuration(step.motion) + DEFAULT_HOLD_SECONDS;
}

/** Total travel distance (mm) implied by a motion. */
export function motionTravelDistance(motion: Motion): number {
  switch (motion.type) {
    case "linear":
      return Math.abs(motion.distance);
    case "L":
      return motion.segments.reduce(
        (sum, segment) => sum + Math.abs(segment.distance),
        0
      );
    case "helix":
      return Math.abs(motion.approach) + Math.abs(motion.pitch * motion.turns);
    case "path": {
      let total = 0;
      for (let i = 1; i < motion.keyframes.length; i++) {
        const current = motion.keyframes[i];
        const previous = motion.keyframes[i - 1];
        if (!current || !previous) continue;
        total += toVector3(current.position).distanceTo(
          toVector3(previous.position)
        );
      }
      return total;
    }
    case "none":
      return 0;
  }
}

/** Animation duration (s) scaled to travel distance, clamped to 1–4 s. */
export function motionDuration(motion: Motion): number {
  if (motion.type === "none") return 0;
  const travel = motionTravelDistance(motion);
  return Math.min(
    MAX_DURATION_S,
    Math.max(MIN_DURATION_S, travel / INSERTION_SPEED_MM_PER_S)
  );
}

/**
 * Builds world-space insertion keyframes for a part whose final (seated)
 * world pose is `basePose`. The last keyframe always equals `basePose`.
 * Returns `null` for `none` motions.
 */
export function motionToKeyframes(
  motion: Motion,
  basePose: Pose,
  options: MotionKeyframeOptions = {}
): MotionKeyframes | null {
  const duration = options.duration ?? motionDuration(motion);
  const finalPosition = toVector3(basePose.position);
  const finalQuaternion = toQuaternion(basePose.quaternion);

  switch (motion.type) {
    case "none":
      return null;

    case "linear": {
      const direction = toVector3(motion.direction).normalize();
      const start = finalPosition
        .clone()
        .addScaledVector(direction, -motion.distance);
      return fromPoses(
        [0, duration],
        [
          { position: start, quaternion: finalQuaternion },
          { position: finalPosition, quaternion: finalQuaternion }
        ]
      );
    }

    case "L": {
      // Walk backwards from the final pose through the segments (insertion
      // order means the last segment ends at the final pose).
      const positions: Vector3[] = [finalPosition.clone()];
      for (let i = motion.segments.length - 1; i >= 0; i--) {
        const segment = motion.segments[i];
        const previous = positions[0];
        if (!segment || !previous) continue;
        const direction = toVector3(segment.direction).normalize();
        positions.unshift(
          previous.clone().addScaledVector(direction, -segment.distance)
        );
      }
      const distances = motion.segments.map((s) => Math.abs(s.distance));
      const total = distances.reduce((sum, d) => sum + d, 0);
      const times: number[] = [0];
      let elapsed = 0;
      for (const distance of distances) {
        elapsed += total > 0 ? (distance / total) * duration : 0;
        times.push(elapsed);
      }
      if (total === 0) times[times.length - 1] = duration;
      return fromPoses(
        times,
        positions.map((position) => ({
          position,
          quaternion: finalQuaternion
        }))
      );
    }

    case "helix": {
      const axis = toVector3(motion.axis).normalize();
      const origin = toVector3(motion.origin);
      const samplesPerTurn = options.samplesPerTurn ?? DEFAULT_SAMPLES_PER_TURN;
      const totalAngle = Math.PI * 2 * motion.turns;
      const threadAdvance = motion.pitch * motion.turns;
      const threadSamples = Math.max(
        1,
        Math.ceil(motion.turns * samplesPerTurn)
      );

      // Pose at the given remaining (un-inserted) thread fraction. r = 1 is
      // the start of threading, r = 0 is seated. The screw transform rotates
      // the final pose backwards about `axis` through `origin` and retracts
      // it along the axis.
      const threadPoseAt = (
        r: number
      ): { position: Vector3; quaternion: Quaternion } => {
        const unscrew = new Quaternion().setFromAxisAngle(
          axis,
          -totalAngle * r
        );
        const position = finalPosition
          .clone()
          .sub(origin)
          .applyQuaternion(unscrew)
          .add(origin)
          .addScaledVector(axis, -threadAdvance * r);
        const quaternion = unscrew.clone().multiply(finalQuaternion);
        return { position, quaternion };
      };

      const approachWeight = Math.abs(motion.approach);
      const threadWeight =
        Math.abs(threadAdvance) > 0
          ? Math.abs(threadAdvance)
          : motion.turns > 0
            ? 1
            : 0;
      const totalWeight = approachWeight + threadWeight;
      const approachTime =
        totalWeight > 0 ? (approachWeight / totalWeight) * duration : 0;

      const times: number[] = [];
      const poses: { position: Vector3; quaternion: Quaternion }[] = [];

      const threadStart = threadPoseAt(1);
      if (motion.approach !== 0) {
        times.push(0);
        poses.push({
          position: threadStart.position
            .clone()
            .addScaledVector(axis, -motion.approach),
          quaternion: threadStart.quaternion
        });
      }
      times.push(approachTime);
      poses.push(threadStart);
      for (let i = 1; i <= threadSamples; i++) {
        const progress = i / threadSamples;
        times.push(approachTime + (duration - approachTime) * progress);
        poses.push(threadPoseAt(1 - progress));
      }
      return fromPoses(times, poses);
    }

    case "path": {
      const keyframes = motion.keyframes;
      const first = keyframes[0];
      const last = keyframes[keyframes.length - 1];
      if (keyframes.length < 2 || !first || !last) {
        throw new Error("path motion requires at least 2 keyframes");
      }
      for (let i = 1; i < keyframes.length; i++) {
        const current = keyframes[i];
        const previous = keyframes[i - 1];
        if (!current || !previous) continue;
        if (current.t <= previous.t) {
          throw new Error(
            "path motion keyframe times must be strictly increasing"
          );
        }
      }
      if (first.t !== 0 || last.t !== 1) {
        throw new Error("path motion keyframes must span t = 0 to t = 1");
      }
      const epsilon = 1e-3;
      if (
        toVector3(last.position).distanceTo(finalPosition) > epsilon ||
        Math.abs(toQuaternion(last.quaternion).dot(finalQuaternion)) <
          1 - epsilon
      ) {
        throw new Error(
          "path motion's last keyframe must equal the part's final pose"
        );
      }
      return fromPoses(
        keyframes.map((keyframe) => keyframe.t * duration),
        keyframes.map((keyframe) => ({
          position: toVector3(keyframe.position),
          quaternion: toQuaternion(keyframe.quaternion)
        }))
      );
    }
  }
}

/**
 * Builds a looping insertion AnimationClip for one step, with position and
 * quaternion tracks for each of the step's parts. Tracks are bound by node
 * uuid so duplicate node names cannot collide. World-space keyframes are
 * converted into each node's parent-local space, so nested assembly
 * transforms are respected. Nodes are assumed to currently sit at their
 * final (seated) pose.
 *
 * Returns `null` for `none` motions or when no part resolves to a node.
 */
export function buildStepClip(
  step: AssemblyStep,
  nodesById: Map<string, Object3D>,
  options: StepClipOptions = {}
): AnimationClip | null {
  if (step.motion.type === "none" || step.partNodeIds.length === 0) {
    return null;
  }

  const duration = options.duration ?? motionDuration(step.motion);
  const holdSeconds = options.holdSeconds ?? DEFAULT_HOLD_SECONDS;
  const tracks: (VectorKeyframeTrack | QuaternionKeyframeTrack)[] = [];

  for (const nodeId of step.partNodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) continue;

    node.updateWorldMatrix(true, false);
    const worldPosition = new Vector3();
    const worldQuaternion = new Quaternion();
    const worldScale = new Vector3();
    node.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);

    const keyframes = motionToKeyframes(
      step.motion,
      {
        position: worldPosition.toArray() as Vec3,
        quaternion: toQuat(worldQuaternion)
      },
      { ...options, duration }
    );
    if (!keyframes) continue;

    const parentWorldInverse = node.parent
      ? node.parent.matrixWorld.clone().invert()
      : new Matrix4();

    const times: number[] = [];
    const positions: number[] = [];
    const quaternions: number[] = [];
    const worldMatrix = new Matrix4();
    const localMatrix = new Matrix4();
    const localPosition = new Vector3();
    const localQuaternion = new Quaternion();
    const localScale = new Vector3();

    const frameCount = keyframes.times.length;
    for (let i = 0; i < frameCount; i++) {
      const time = keyframes.times[i];
      if (time === undefined) continue;
      const position = new Vector3().fromArray(keyframes.positions, i * 3);
      const quaternion = new Quaternion().fromArray(
        keyframes.quaternions,
        i * 4
      );
      worldMatrix.compose(position, quaternion, worldScale);
      localMatrix.multiplyMatrices(parentWorldInverse, worldMatrix);
      localMatrix.decompose(localPosition, localQuaternion, localScale);
      times.push(time);
      positions.push(localPosition.x, localPosition.y, localPosition.z);
      quaternions.push(
        localQuaternion.x,
        localQuaternion.y,
        localQuaternion.z,
        localQuaternion.w
      );
    }

    // Hold the seated pose so LoopRepeat pauses before restarting.
    const lastTime = times[times.length - 1];
    if (holdSeconds > 0 && lastTime !== undefined) {
      times.push(lastTime + holdSeconds);
      positions.push(...positions.slice(-3));
      quaternions.push(...quaternions.slice(-4));
    }

    tracks.push(
      new VectorKeyframeTrack(`${node.uuid}.position`, times, positions),
      new QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, quaternions)
    );
  }

  if (tracks.length === 0) return null;
  return new AnimationClip(`step:${step.id}`, duration + holdSeconds, tracks);
}

function toVector3(value: Vec3): Vector3 {
  return new Vector3(value[0], value[1], value[2]);
}

function toQuaternion(value: Quat): Quaternion {
  return new Quaternion(value[0], value[1], value[2], value[3]).normalize();
}

function toQuat(quaternion: Quaternion): Quat {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function fromPoses(
  times: number[],
  poses: { position: Vector3; quaternion: Quaternion }[]
): MotionKeyframes {
  const positions: number[] = [];
  const quaternions: number[] = [];
  for (const pose of poses) {
    positions.push(pose.position.x, pose.position.y, pose.position.z);
    quaternions.push(
      pose.quaternion.x,
      pose.quaternion.y,
      pose.quaternion.z,
      pose.quaternion.w
    );
  }
  return { times, positions, quaternions };
}
