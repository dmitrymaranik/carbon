import {
  AnimationMixer,
  Group,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3
} from "three";
import { describe, expect, it } from "vitest";
import {
  buildStepClip,
  exaggerateMotion,
  type MotionKeyframes,
  motionDuration,
  motionToKeyframes,
  motionTravelDistance,
  type Pose
} from "./motion";
import type { AssemblyStep, Motion } from "./types";

const IDENTITY_POSE: Pose = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1]
};

function positionAt(keyframes: MotionKeyframes, index: number): number[] {
  return keyframes.positions.slice(index * 3, index * 3 + 3);
}

function quaternionAt(keyframes: MotionKeyframes, index: number): number[] {
  return keyframes.quaternions.slice(index * 4, index * 4 + 4);
}

function lastIndex(keyframes: MotionKeyframes): number {
  return keyframes.times.length - 1;
}

function expectVectorClose(actual: number[], expected: number[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 6);
  });
}

function expectMonotonicTimes(keyframes: MotionKeyframes) {
  expect(keyframes.times[0]).toBe(0);
  for (let i = 1; i < keyframes.times.length; i++) {
    expect(keyframes.times[i]).toBeGreaterThan(
      keyframes.times[i - 1] ?? Number.POSITIVE_INFINITY
    );
  }
}

function makeStep(motion: Motion, partNodeIds: string[]): AssemblyStep {
  return {
    id: "step-1",
    title: null,
    instructionText: null,
    partNodeIds,
    motion,
    camera: null,
    fastener: null
  };
}

describe("motionTravelDistance", () => {
  it("computes travel for each motion type", () => {
    expect(
      motionTravelDistance({
        type: "linear",
        direction: [0, 0, -1],
        distance: 80
      })
    ).toBe(80);
    expect(
      motionTravelDistance({
        type: "L",
        segments: [
          { direction: [1, 0, 0], distance: 60 },
          { direction: [0, 0, -1], distance: 20 }
        ]
      })
    ).toBe(80);
    expect(
      motionTravelDistance({
        type: "helix",
        axis: [0, 0, -1],
        origin: [0, 0, 0],
        pitch: 0.8,
        turns: 6,
        approach: 30
      })
    ).toBeCloseTo(34.8);
    expect(motionTravelDistance({ type: "none" })).toBe(0);
  });
});

describe("motionDuration", () => {
  it("scales with travel distance and clamps to 1-4 s", () => {
    expect(
      motionDuration({ type: "linear", direction: [0, 0, 1], distance: 6 })
    ).toBe(1);
    expect(
      motionDuration({ type: "linear", direction: [0, 0, 1], distance: 120 })
    ).toBeCloseTo(2);
    expect(
      motionDuration({ type: "linear", direction: [0, 0, 1], distance: 6000 })
    ).toBe(4);
    expect(motionDuration({ type: "none" })).toBe(0);
  });
});

describe("motionToKeyframes", () => {
  it("returns null for none motions", () => {
    expect(motionToKeyframes({ type: "none" }, IDENTITY_POSE)).toBeNull();
  });

  it("linear: starts displaced against the insertion direction and ends at the final pose", () => {
    const basePose: Pose = {
      position: [10, 20, 30],
      quaternion: [0, 0, 0, 1]
    };
    const keyframes = motionToKeyframes(
      { type: "linear", direction: [0, 0, -1], distance: 80 },
      basePose,
      { duration: 2 }
    );
    expect(keyframes).not.toBeNull();
    if (!keyframes) return;

    expectMonotonicTimes(keyframes);
    expect(keyframes.times).toEqual([0, 2]);
    expectVectorClose(positionAt(keyframes, 0), [10, 20, 110]);
    expectVectorClose(
      positionAt(keyframes, lastIndex(keyframes)),
      [10, 20, 30]
    );
    expectVectorClose(quaternionAt(keyframes, 0), [0, 0, 0, 1]);
    expectVectorClose(
      quaternionAt(keyframes, lastIndex(keyframes)),
      [0, 0, 0, 1]
    );
  });

  it("linear: normalizes the direction vector", () => {
    const keyframes = motionToKeyframes(
      { type: "linear", direction: [0, 0, -10], distance: 80 },
      IDENTITY_POSE
    );
    if (!keyframes) throw new Error("expected keyframes");
    expectVectorClose(positionAt(keyframes, 0), [0, 0, 80]);
  });

  it("L: walks segments backwards from the final pose with proportional times", () => {
    const keyframes = motionToKeyframes(
      {
        type: "L",
        segments: [
          { direction: [1, 0, 0], distance: 60 },
          { direction: [0, 0, -1], distance: 20 }
        ]
      },
      IDENTITY_POSE,
      { duration: 2 }
    );
    if (!keyframes) throw new Error("expected keyframes");

    expectMonotonicTimes(keyframes);
    expect(keyframes.times.length).toBe(3);
    // 60 of 80 mm in segment 1 → 75% of the duration
    expect(keyframes.times[1]).toBeCloseTo(1.5);
    expect(keyframes.times[2]).toBeCloseTo(2);
    expectVectorClose(positionAt(keyframes, 0), [-60, 0, 20]);
    expectVectorClose(positionAt(keyframes, 1), [0, 0, 20]);
    expectVectorClose(positionAt(keyframes, 2), [0, 0, 0]);
  });

  it("helix: retracts by approach + pitch*turns and ends seated at the final pose", () => {
    const basePose: Pose = {
      position: [10, 20, 5],
      quaternion: [0, 0, 0, 1]
    };
    const motion: Motion = {
      type: "helix",
      axis: [0, 0, -1],
      origin: [10, 20, 5], // through the part center so rotation keeps position
      pitch: 0.8,
      turns: 6,
      approach: 30
    };
    const keyframes = motionToKeyframes(motion, basePose, {
      samplesPerTurn: 4
    });
    if (!keyframes) throw new Error("expected keyframes");

    expectMonotonicTimes(keyframes);
    // 1 approach start + 1 threading start + turns * samplesPerTurn samples
    expect(keyframes.times.length).toBe(2 + 6 * 4);
    expect(keyframes.quaternions.length).toBe((2 + 6 * 4) * 4);

    // Start fully retracted along the axis: approach + pitch*turns = 34.8 mm
    expectVectorClose(positionAt(keyframes, 0), [10, 20, 5 + 34.8]);
    // Threading start: approach consumed, thread advance remaining
    expectVectorClose(positionAt(keyframes, 1), [10, 20, 5 + 4.8]);
    // Seated
    const last = lastIndex(keyframes);
    expectVectorClose(positionAt(keyframes, last), [10, 20, 5]);
    expectVectorClose(quaternionAt(keyframes, last), [0, 0, 0, 1]);

    // Rotation actually happens between thread samples (quarter turns)
    const intermediate = quaternionAt(keyframes, 2);
    const final = quaternionAt(keyframes, last);
    const dot = intermediate.reduce(
      (sum, value, index) => sum + value * (final[index] ?? Number.NaN),
      0
    );
    expect(Math.abs(dot)).toBeLessThan(0.999);
  });

  it("helix: ends exactly at the final pose even when origin is off-axis from the part", () => {
    const basePose: Pose = {
      position: [10, 0, 0],
      quaternion: [0, 0, 0, 1]
    };
    const keyframes = motionToKeyframes(
      {
        type: "helix",
        axis: [0, 0, 1],
        origin: [0, 0, 0],
        pitch: 1,
        turns: 2.5,
        approach: 10
      },
      basePose
    );
    if (!keyframes) throw new Error("expected keyframes");
    const last = lastIndex(keyframes);
    expectVectorClose(positionAt(keyframes, last), [10, 0, 0]);
    expectVectorClose(quaternionAt(keyframes, last), [0, 0, 0, 1]);
    expectMonotonicTimes(keyframes);
  });

  it("path: passes absolute world poses through, scaling t by duration", () => {
    const keyframes = motionToKeyframes(
      {
        type: "path",
        keyframes: [
          { t: 0, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
          { t: 0.5, position: [0, 50, 50], quaternion: [0, 0, 0, 1] },
          { t: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
        ]
      },
      IDENTITY_POSE,
      { duration: 2 }
    );
    if (!keyframes) throw new Error("expected keyframes");
    expect(keyframes.times).toEqual([0, 1, 2]);
    expectVectorClose(positionAt(keyframes, 0), [0, 0, 100]);
    expectVectorClose(positionAt(keyframes, 1), [0, 50, 50]);
    expectVectorClose(positionAt(keyframes, 2), [0, 0, 0]);
  });

  it("path: rejects non-monotonic times", () => {
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [
            { t: 0, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
            { t: 0.5, position: [0, 0, 50], quaternion: [0, 0, 0, 1] },
            { t: 0.5, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
          ]
        },
        IDENTITY_POSE
      )
    ).toThrow(/strictly increasing/);
  });

  it("path: rejects a last keyframe that is not the final pose", () => {
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [
            { t: 0, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
            { t: 1, position: [0, 0, 5], quaternion: [0, 0, 0, 1] }
          ]
        },
        IDENTITY_POSE
      )
    ).toThrow(/final pose/);
  });

  it("path: requires t to span 0..1 and at least 2 keyframes", () => {
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [{ t: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }]
        },
        IDENTITY_POSE
      )
    ).toThrow(/at least 2/);
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [
            { t: 0.1, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
            { t: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
          ]
        },
        IDENTITY_POSE
      )
    ).toThrow(/span/);
  });
});

describe("buildStepClip", () => {
  function makeAssembly() {
    const root = new Group();
    const parent = new Group();
    parent.position.set(5, 0, 0);
    root.add(parent);
    const part = new Object3D();
    part.position.set(1, 2, 3);
    part.userData.nodeId = "node-a";
    parent.add(part);
    root.updateMatrixWorld(true);
    return { root, part, parent, nodesById: new Map([["node-a", part]]) };
  }

  it("returns null for none motions and for steps with no resolvable parts", () => {
    const { nodesById } = makeAssembly();
    expect(
      buildStepClip(makeStep({ type: "none" }, ["node-a"]), nodesById)
    ).toBeNull();
    expect(
      buildStepClip(
        makeStep({ type: "linear", direction: [1, 0, 0], distance: 10 }, []),
        nodesById
      )
    ).toBeNull();
    expect(
      buildStepClip(
        makeStep({ type: "linear", direction: [1, 0, 0], distance: 10 }, [
          "missing-node"
        ]),
        nodesById
      )
    ).toBeNull();
  });

  it("builds uuid-bound position/quaternion tracks in parent-local space with a seated hold", () => {
    const { part, nodesById } = makeAssembly();
    const step = makeStep(
      { type: "linear", direction: [1, 0, 0], distance: 10 },
      ["node-a"]
    );
    const clip = buildStepClip(step, nodesById, {
      duration: 2,
      holdSeconds: 0.5
    });
    expect(clip).not.toBeNull();
    if (!clip) return;

    expect(clip.name).toBe("step:step-1");
    expect(clip.duration).toBeCloseTo(2.5);
    expect(clip.tracks.length).toBe(2);
    const [positionTrack, quaternionTrack] = clip.tracks;
    if (!positionTrack || !quaternionTrack) throw new Error("expected tracks");
    expect(positionTrack.name).toBe(`${part.uuid}.position`);
    expect(quaternionTrack.name).toBe(`${part.uuid}.quaternion`);

    // World start [6,2,3] - [10,0,0] = [-4,2,3] → parent-local [-9,2,3]
    expectVectorClose([...positionTrack.values.slice(0, 3)], [-9, 2, 3]);
    // Seated keyframe and hold keyframe both equal the part's local pose
    expectVectorClose([...positionTrack.values.slice(-6, -3)], [1, 2, 3]);
    expectVectorClose([...positionTrack.values.slice(-3)], [1, 2, 3]);
    // Hold keyframe extends the timeline
    const times = positionTrack.times;
    expect(times[times.length - 1]).toBeCloseTo(2.5);
    expect(times[times.length - 2]).toBeCloseTo(2);
  });

  it("converts world-space motion into the local space of a rotated parent", () => {
    const root = new Group();
    const parent = new Group();
    parent.rotation.z = Math.PI / 2;
    root.add(parent);
    const part = new Object3D();
    part.userData.nodeId = "node-b";
    parent.add(part);
    root.updateMatrixWorld(true);
    const nodesById = new Map([["node-b", part]]);

    const step = makeStep(
      { type: "linear", direction: [0, 1, 0], distance: 10 },
      ["node-b"]
    );
    const clip = buildStepClip(step, nodesById, { holdSeconds: 0 });
    if (!clip) throw new Error("expected clip");

    const expectedStart = new Vector3(0, -10, 0).applyMatrix4(
      new Matrix4().copy(parent.matrixWorld).invert()
    );
    const [positionTrack, quaternionTrack] = clip.tracks;
    if (!positionTrack || !quaternionTrack) throw new Error("expected tracks");
    expectVectorClose(
      [...positionTrack.values.slice(0, 3)],
      expectedStart.toArray()
    );
    expectVectorClose([...positionTrack.values.slice(-3)], [0, 0, 0]);

    const localQuaternion = new Quaternion().copy(part.quaternion);
    expectVectorClose(
      [...quaternionTrack.values.slice(-4)],
      [
        localQuaternion.x,
        localQuaternion.y,
        localQuaternion.z,
        localQuaternion.w
      ]
    );
  });

  it("clamps the default duration to 1-4 s based on travel distance", () => {
    const { nodesById } = makeAssembly();
    const short = buildStepClip(
      makeStep({ type: "linear", direction: [1, 0, 0], distance: 1 }, [
        "node-a"
      ]),
      nodesById,
      { holdSeconds: 0 }
    );
    const long = buildStepClip(
      makeStep({ type: "linear", direction: [1, 0, 0], distance: 6000 }, [
        "node-a"
      ]),
      nodesById,
      { holdSeconds: 0 }
    );
    expect(short?.duration).toBeCloseTo(1);
    expect(long?.duration).toBeCloseTo(4);
  });

  it("drives nodes through an AnimationMixer via uuid-bound tracks", () => {
    const { root, part, nodesById } = makeAssembly();
    const step = makeStep(
      { type: "linear", direction: [1, 0, 0], distance: 10 },
      ["node-a"]
    );
    const clip = buildStepClip(step, nodesById, {
      duration: 2,
      holdSeconds: 0
    });
    if (!clip) throw new Error("expected clip");

    const mixer = new AnimationMixer(root);
    mixer.clipAction(clip).play();

    mixer.update(0); // t = 0 → displaced start pose (local [-9, 2, 3])
    expect(part.position.x).toBeCloseTo(-9);
    mixer.update(1); // t = 1 → halfway back to seated
    expect(part.position.x).toBeCloseTo(-4);
    expect(part.position.y).toBeCloseTo(2);
    expect(part.position.z).toBeCloseTo(3);
  });
});

describe("exaggerateMotion", () => {
  const lift = {
    type: "linear",
    direction: [0, 0, -1] as [number, number, number],
    distance: 15
  } as const;

  it("stretches small-part travel to a readable distance", () => {
    // 20mm bolt in a 1000mm assembly travels at least 2.5x its size
    const result = exaggerateMotion(lift, 20, 1000);
    expect(result.type).toBe("linear");
    if (result.type === "linear") {
      expect(result.distance).toBe(50);
    }
  });

  it("leaves large parts unchanged", () => {
    expect(exaggerateMotion(lift, 400, 1000)).toBe(lift);
  });

  it("leaves already-long travels unchanged", () => {
    const long = { ...lift, distance: 200 };
    expect(exaggerateMotion(long, 20, 1000)).toBe(long);
  });

  it("scales L segments proportionally", () => {
    const motion = {
      type: "L",
      segments: [
        { direction: [1, 0, 0] as [number, number, number], distance: 6 },
        { direction: [0, 0, -1] as [number, number, number], distance: 4 }
      ]
    } as const;
    const result = exaggerateMotion(motion, 20, 1000);
    if (result.type === "L") {
      const total = result.segments.reduce((sum, s) => sum + s.distance, 0);
      expect(total).toBeCloseTo(50);
      expect(
        result.segments[0]!.distance / result.segments[1]!.distance
      ).toBeCloseTo(6 / 4);
    } else {
      throw new Error("expected L motion");
    }
  });

  it("does not exaggerate none motions", () => {
    const none = { type: "none" } as const;
    expect(exaggerateMotion(none, 20, 1000)).toBe(none);
  });
});
