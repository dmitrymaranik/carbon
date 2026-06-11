import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimationMixer,
  Box3,
  Color,
  LoopOnce,
  type Material,
  type Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Vector3
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { AssemblyViewer } from "./AssemblyViewer";
import { describeStep } from "./describe";
import { indexAssemblyGraph } from "./graph";
import { buildStepClip, exaggerateMotion, stepTimelineSeconds } from "./motion";
import type { AssemblyGraph, AssemblyStep } from "./types";
import { useAssembly } from "./useAssembly";
import { cn } from "./utils";

/** How parts of steps after the active one are rendered. */
export type FuturePartsMode = "ghost" | "hidden" | "solid";

export type AssemblyPlayerProps = {
  glbUrl: string;
  graphUrl: string;
  steps: AssemblyStep[];
  activeStepIndex: number;
  onStepChange?: (index: number) => void;
  /** Click-to-select part nodeIds for the editor (additive with shift held) */
  onSelectParts?: (nodeIds: string[]) => void;
  /** Surfaces the parsed graph.json once loaded (for BOM/title derivation) */
  onGraphLoaded?: (graph: AssemblyGraph) => void;
  /**
   * External (e.g. BOM-driven) highlight. Highlighted parts render with an
   * emissive tint and stay visible even when their step would hide them.
   * Independent of click-selection.
   */
  highlightedNodeIds?: string[];
  /** Parts hidden from the viewer entirely (fixtures, reference geometry) */
  hiddenNodeIds?: string[];
  /** Disables part selection (MES playback) */
  readOnly?: boolean;
  /** Initial render mode for future-step parts */
  defaultFutureMode?: FuturePartsMode;
  mode?: "dark" | "light";
  className?: string;
};

/**
 * Animated assembly playback per the assembly contracts (section 5):
 * - parts of steps before the active step are shown solid at their final pose
 * - parts of the active step play their insertion motion once, holding the
 *   seated pose
 * - parts of later steps render per the future-parts mode: ghosted at low
 *   opacity in their original color (default), hidden, or solid
 * - parts in no step (base/fixture parts) are always shown solid
 *
 * All steps form one continuous timeline: playing advances through steps
 * automatically, the scrubber maps to global seconds (step boundaries are
 * tick marks), and the footer shows elapsed / total time.
 */
export function AssemblyPlayer({
  glbUrl,
  graphUrl,
  steps,
  activeStepIndex,
  onStepChange,
  onSelectParts,
  onGraphLoaded,
  highlightedNodeIds,
  hiddenNodeIds,
  readOnly = false,
  defaultFutureMode = "ghost",
  mode = "dark",
  className
}: AssemblyPlayerProps) {
  const { scene, nodesById, graph, isLoading, error } = useAssembly(
    glbUrl,
    graphUrl
  );
  const [isPlaying, setIsPlaying] = useState(true);
  const [futureMode, setFutureMode] =
    useState<FuturePartsMode>(defaultFutureMode);

  useEffect(() => {
    if (graph) onGraphLoaded?.(graph);
  }, [graph, onGraphLoaded]);

  const graphIndex = useMemo(
    () => (graph ? indexAssemblyGraph(graph) : null),
    [graph]
  );

  const stepCount = steps.length;
  const clampedIndex = Math.min(Math.max(activeStepIndex, 0), stepCount - 1);
  const activeStep = steps[clampedIndex] ?? null;
  const activeStepTitle = activeStep
    ? describeStep(activeStep, graphIndex)
    : null;

  // Small parts (bolts, washers) get exaggerated travel so their insertion
  // reads clearly at assembly scale — display only, the data is untouched
  const displaySteps = useMemo(() => {
    if (!graphIndex) return steps;
    const root = graphIndex.graph.root.bbox;
    const assemblyDiagonal = Math.hypot(
      root.max[0] - root.min[0],
      root.max[1] - root.min[1],
      root.max[2] - root.min[2]
    );
    return steps.map((step) => {
      let minBox: [number, number, number] | null = null;
      let maxBox: [number, number, number] | null = null;
      for (const nodeId of step.partNodeIds) {
        const node = graphIndex.nodesById.get(nodeId);
        if (!node) continue;
        if (!minBox || !maxBox) {
          minBox = [...node.bbox.min];
          maxBox = [...node.bbox.max];
        } else {
          for (let axis = 0; axis < 3; axis++) {
            minBox[axis] = Math.min(
              minBox[axis] ?? 0,
              node.bbox.min[axis] ?? 0
            );
            maxBox[axis] = Math.max(
              maxBox[axis] ?? 0,
              node.bbox.max[axis] ?? 0
            );
          }
        }
      }
      if (!minBox || !maxBox) return step;
      const partDiagonal = Math.hypot(
        maxBox[0] - minBox[0],
        maxBox[1] - minBox[1],
        maxBox[2] - minBox[2]
      );
      const motion = exaggerateMotion(
        step.motion,
        partDiagonal,
        assemblyDiagonal
      );
      return motion === step.motion ? step : { ...step, motion };
    });
  }, [steps, graphIndex]);

  // --- Continuous timeline ---------------------------------------------
  const segments = useMemo(
    () => displaySteps.map(stepTimelineSeconds),
    [displaySteps]
  );
  const startTimes = useMemo(() => {
    let elapsed = 0;
    return segments.map((segment) => {
      const start = elapsed;
      elapsed += segment;
      return start;
    });
  }, [segments]);
  const totalSeconds = useMemo(
    () => segments.reduce((sum, segment) => sum + segment, 0),
    [segments]
  );

  /** Global playhead in seconds, written by the scene each frame */
  const playheadRef = useRef(0);
  /** Pending seek (seconds within the active step), consumed by the scene */
  const seekRef = useRef<number | null>(null);
  const [seekVersion, setSeekVersion] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);

  // The playhead advances inside the render loop; poll it for the footer
  // instead of re-rendering React at frame rate.
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayTime((previous) => {
        const next = playheadRef.current;
        return Math.abs(next - previous) > 0.05 ? next : previous;
      });
    }, 200);
    return () => clearInterval(id);
  }, []);

  const goToStep = useCallback(
    (index: number) => {
      if (index < 0 || index >= stepCount) return;
      seekRef.current = 0;
      playheadRef.current = startTimes[index] ?? 0;
      setDisplayTime(startTimes[index] ?? 0);
      if (index === activeStepIndex) {
        setSeekVersion((version) => version + 1);
      } else {
        onStepChange?.(index);
      }
    },
    [onStepChange, stepCount, startTimes, activeStepIndex]
  );

  const handleStepFinished = useCallback(() => {
    if (clampedIndex < stepCount - 1) {
      goToStep(clampedIndex + 1);
    } else {
      setIsPlaying(false);
    }
  }, [clampedIndex, stepCount, goToStep]);

  const onScrub = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, totalSeconds));
      let index = 0;
      while (
        index < stepCount - 1 &&
        clamped >= (startTimes[index + 1] ?? Number.POSITIVE_INFINITY)
      ) {
        index++;
      }
      seekRef.current = clamped - (startTimes[index] ?? 0);
      playheadRef.current = clamped;
      setDisplayTime(clamped);
      if (index !== clampedIndex) {
        onStepChange?.(index);
      } else {
        setSeekVersion((version) => version + 1);
      }
    },
    [totalSeconds, stepCount, startTimes, clampedIndex, onStepChange]
  );

  return (
    <div className={cn("flex h-full w-full flex-col", className)}>
      <div className="relative min-h-0 flex-1">
        <AssemblyViewer mode={mode} className="absolute inset-0">
          {scene && (
            <AssemblyScene
              key={scene.uuid}
              scene={scene}
              nodesById={nodesById}
              steps={displaySteps}
              activeStepIndex={clampedIndex}
              isPlaying={isPlaying}
              futureMode={futureMode}
              highlightedNodeIds={highlightedNodeIds}
              hiddenNodeIds={hiddenNodeIds}
              readOnly={readOnly}
              onSelectParts={onSelectParts}
              assemblyBounds={graphIndex?.graph.root.bbox ?? null}
              leafBounds={graphIndex?.leaves ?? null}
              segments={segments}
              startTimes={startTimes}
              playheadRef={playheadRef}
              seekRef={seekRef}
              seekVersion={seekVersion}
              onStepFinished={handleStepFinished}
            />
          )}
        </AssemblyViewer>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg
              className="h-6 w-6 animate-spin text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              aria-label="Loading model"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <p className="text-sm text-destructive">{error.message}</p>
          </div>
        )}
        {stepCount > 1 && (
          <>
            <OverlayNavButton
              side="left"
              aria-label="Previous step"
              disabled={clampedIndex <= 0}
              onClick={() => goToStep(clampedIndex - 1)}
            />
            <OverlayNavButton
              side="right"
              aria-label="Next step"
              disabled={clampedIndex >= stepCount - 1}
              onClick={() => goToStep(clampedIndex + 1)}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border bg-background px-3 py-2">
        <ControlButton
          aria-label="Previous step"
          disabled={clampedIndex <= 0}
          onClick={() => goToStep(clampedIndex - 1)}
        >
          <ChevronLeftIcon />
        </ControlButton>
        <ControlButton
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={() => {
            // Pressing play at the end restarts from the beginning
            if (
              !isPlaying &&
              stepCount > 0 &&
              playheadRef.current >= totalSeconds - 0.05
            ) {
              onScrub(0);
            }
            setIsPlaying((playing) => !playing);
          }}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </ControlButton>
        <ControlButton
          aria-label="Next step"
          disabled={clampedIndex >= stepCount - 1}
          onClick={() => goToStep(clampedIndex + 1)}
        >
          <ChevronRightIcon />
        </ControlButton>
        <div className="relative min-w-0 flex-1">
          <input
            type="range"
            aria-label="Timeline"
            className="w-full accent-primary"
            min={0}
            max={Math.max(totalSeconds, 0.01)}
            step={0.05}
            value={Math.min(displayTime, totalSeconds)}
            disabled={stepCount === 0}
            onChange={(changeEvent) =>
              onScrub(Number(changeEvent.target.value))
            }
          />
          {totalSeconds > 0 &&
            startTimes
              .slice(1)
              .map((startTime) => (
                <span
                  key={startTime}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-muted-foreground/40"
                  style={{ left: `${(startTime / totalSeconds) * 100}%` }}
                />
              ))}
        </div>
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {stepCount > 0
            ? `${formatTime(Math.min(displayTime, totalSeconds))} / ${formatTime(totalSeconds)}`
            : "–"}
        </span>
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {stepCount > 0 ? `${clampedIndex + 1} / ${stepCount}` : ""}
        </span>
        <div className="flex items-center rounded-md border border-border">
          <ControlButton
            aria-label="Show future parts ghosted"
            aria-pressed={futureMode === "ghost"}
            isActive={futureMode === "ghost"}
            onClick={() => setFutureMode("ghost")}
          >
            <GhostIcon />
          </ControlButton>
          <ControlButton
            aria-label="Hide future parts"
            aria-pressed={futureMode === "hidden"}
            isActive={futureMode === "hidden"}
            onClick={() => setFutureMode("hidden")}
          >
            <HiddenIcon />
          </ControlButton>
          <ControlButton
            aria-label="Show all parts solid"
            aria-pressed={futureMode === "solid"}
            isActive={futureMode === "solid"}
            onClick={() => setFutureMode("solid")}
          >
            <SolidIcon />
          </ControlButton>
        </div>
      </div>

      {activeStep && (activeStepTitle || activeStep.instructionText) && (
        <div className="border-t border-border bg-background px-3 py-2">
          {activeStepTitle && (
            <p className="text-sm font-medium text-foreground">
              {activeStepTitle}
            </p>
          )}
          {activeStep.instructionText && (
            <p className="text-sm text-muted-foreground">
              {activeStep.instructionText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type PartVisual = "solid" | "active" | "hidden" | "ghost";

type OverrideKind = "ghost" | "highlight" | "selected" | "external";

type MaterialOverrides = {
  original: Material | Material[];
  /** Clones are created lazily on first use, not per mesh up front */
  ghost?: Material | Material[];
  highlight?: Material | Material[];
  selected?: Material | Material[];
  external?: Material | Material[];
};

const HIGHLIGHT_COLOR = 0x3b82f6;
const SELECTED_COLOR = 0xf59e0b;
const EXTERNAL_COLOR = 0x10b981;
const GHOST_OPACITY = 0.3;

function AssemblyScene({
  scene,
  nodesById,
  steps,
  activeStepIndex,
  isPlaying,
  futureMode,
  highlightedNodeIds,
  hiddenNodeIds,
  readOnly,
  onSelectParts,
  assemblyBounds,
  leafBounds,
  segments,
  startTimes,
  playheadRef,
  seekRef,
  seekVersion,
  onStepFinished
}: {
  scene: Object3D;
  nodesById: Map<string, Object3D>;
  steps: AssemblyStep[];
  activeStepIndex: number;
  isPlaying: boolean;
  futureMode: FuturePartsMode;
  highlightedNodeIds?: string[];
  hiddenNodeIds?: string[];
  readOnly: boolean;
  onSelectParts?: (nodeIds: string[]) => void;
  /** Seated world bounds from graph.json (stable under animation) */
  assemblyBounds: { min: number[]; max: number[] } | null;
  /** Seated per-leaf bounds for camera occlusion scoring */
  leafBounds:
    | { nodeId: string; bbox: { min: number[]; max: number[] } }[]
    | null;
  /** Timeline seconds per step */
  segments: number[];
  /** Timeline start (seconds) of each step */
  startTimes: number[];
  /** Written each frame with the global playhead (seconds) */
  playheadRef: React.MutableRefObject<number>;
  /** Pending seek (seconds within the active step); consumed on apply */
  seekRef: React.MutableRefObject<number | null>;
  /** Bumped to re-apply a seek within the same step */
  seekVersion: number;
  /** The active step's timeline segment has fully elapsed */
  onStepFinished?: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls
  ) as unknown as OrbitControlsImpl | null;
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );

  const highlightedSet = useMemo(
    () => new Set(highlightedNodeIds ?? []),
    [highlightedNodeIds]
  );

  const hiddenSet = useMemo(
    () => new Set(hiddenNodeIds ?? []),
    [hiddenNodeIds]
  );

  /** nodeId → index of the first step that installs it */
  const stepIndexByNode = useMemo(() => {
    const map = new Map<string, number>();
    steps.forEach((step, index) => {
      for (const nodeId of step.partNodeIds) {
        if (!map.has(nodeId)) map.set(nodeId, index);
      }
    });
    return map;
  }, [steps]);

  // --- Part visual states (visibility + material overrides) ---------------

  const overridesRef = useRef(new Map<Mesh, MaterialOverrides>());

  // AssemblyScene is keyed by scene uuid, so unmount means the scene is done:
  // dispose the cloned override materials.
  useEffect(() => {
    const overrides = overridesRef.current;
    return () => {
      for (const entry of overrides.values()) {
        if (entry.ghost) disposeMaterials(entry.ghost);
        if (entry.highlight) disposeMaterials(entry.highlight);
        if (entry.selected) disposeMaterials(entry.selected);
        if (entry.external) disposeMaterials(entry.external);
      }
      overrides.clear();
    };
  }, []);

  useEffect(() => {
    const overrides = overridesRef.current;

    // Reset: everything visible with its original material
    for (const node of nodesById.values()) {
      node.visible = true;
    }
    for (const [mesh, entry] of overrides) {
      mesh.material = entry.original;
      mesh.renderOrder = 0;
    }

    const applyVisual = (node: Object3D, visual: PartVisual) => {
      if (visual === "hidden") {
        node.visible = false;
        return;
      }
      if (visual === "solid") return;
      node.traverse((object) => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        if (visual === "ghost") {
          mesh.material = getOverride(mesh, overrides, "ghost");
          // Draw transparent ghosts after opaque parts to limit sorting artifacts
          mesh.renderOrder = 1;
        } else {
          mesh.material = getOverride(mesh, overrides, "highlight");
        }
      });
    };

    for (const [nodeId, stepIndex] of stepIndexByNode) {
      const node = nodesById.get(nodeId);
      if (!node) continue;
      const visual: PartVisual =
        stepIndex < activeStepIndex
          ? "solid"
          : stepIndex === activeStepIndex
            ? "active"
            : futureMode === "ghost"
              ? "ghost"
              : futureMode === "hidden"
                ? "hidden"
                : "solid";
      applyVisual(node, visual);
    }

    // External (BOM) highlight: emissive tint, forced visible even when the
    // part's step would hide it ("show me all the M8 bolts")
    for (const nodeId of highlightedSet) {
      const node = nodesById.get(nodeId);
      if (!node) continue;
      node.visible = true;
      node.traverse((object) => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        mesh.material = getOverride(mesh, overrides, "external");
        mesh.renderOrder = 0;
      });
    }

    // Explicitly hidden parts (fixtures/reference geometry) always hide,
    // even when highlighted
    for (const nodeId of hiddenSet) {
      const node = nodesById.get(nodeId);
      if (node) node.visible = false;
    }

    // Click-selection renders on top of everything else
    for (const nodeId of selectedIds) {
      const node = nodesById.get(nodeId);
      if (!node || !node.visible) continue;
      node.traverse((object) => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        mesh.material = getOverride(mesh, overrides, "selected");
      });
    }
  }, [
    nodesById,
    stepIndexByNode,
    activeStepIndex,
    futureMode,
    highlightedSet,
    hiddenSet,
    selectedIds
  ]);

  // --- Animation -----------------------------------------------------------

  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const actionRef = useRef<ReturnType<AnimationMixer["clipAction"]> | null>(
    null
  );
  /** Seconds elapsed within the active step's timeline segment */
  const localElapsedRef = useRef(0);
  const finishedRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: seekVersion intentionally re-applies a pending seek within the same step
  useEffect(() => {
    const step = steps[activeStepIndex];

    // Consume any pending seek; otherwise the step starts at 0
    const seek = seekRef.current;
    seekRef.current = null;
    localElapsedRef.current = seek ?? 0;
    finishedRef.current = false;
    playheadRef.current =
      (startTimes[activeStepIndex] ?? 0) + localElapsedRef.current;

    if (!step) return;

    const clip = buildStepClip(step, nodesById);
    if (!clip) return;

    // Save seated transforms so we can restore them when the step changes
    const restore = step.partNodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is Object3D => Boolean(node))
      .map((node) => ({
        node,
        position: node.position.clone(),
        quaternion: node.quaternion.clone()
      }));

    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    if (seek !== null) {
      action.time = Math.min(seek, clip.duration);
      mixer.update(0);
    }
    actionRef.current = action;

    return () => {
      action.stop();
      mixer.uncacheClip(clip);
      actionRef.current = null;
      for (const { node, position, quaternion } of restore) {
        node.position.copy(position);
        node.quaternion.copy(quaternion);
      }
    };
    // seekVersion re-applies a seek within the same step
  }, [
    mixer,
    nodesById,
    steps,
    activeStepIndex,
    seekVersion,
    seekRef,
    playheadRef,
    startTimes
  ]);

  useEffect(() => {
    if (actionRef.current) actionRef.current.paused = !isPlaying;
  }, [isPlaying]);

  useFrame((_, delta) => {
    if (isPlaying) {
      mixer.update(delta);
      localElapsedRef.current += delta;
    }
    const segment = segments[activeStepIndex] ?? 0;
    const clamped = Math.min(localElapsedRef.current, segment);
    playheadRef.current = (startTimes[activeStepIndex] ?? 0) + clamped;
    if (
      isPlaying &&
      !finishedRef.current &&
      segment > 0 &&
      localElapsedRef.current >= segment
    ) {
      finishedRef.current = true;
      onStepFinished?.();
    }
  });

  // --- Camera ----------------------------------------------------------------

  const frameBox = useCallback(
    (box: Box3) => {
      if (box.isEmpty() || !controls) return;
      const center = box.getCenter(new Vector3());
      const radius = box.getSize(new Vector3()).length() / 2;
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
      const distance = Math.max(
        (radius / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.4,
        radius * 2
      );
      const direction = camera.position
        .clone()
        .sub(controls.target)
        .normalize();
      if (direction.lengthSq() === 0) direction.set(1, 1, 1).normalize();
      camera.position.copy(center).addScaledVector(direction, distance);
      controls.target.copy(center);
      controls.update();
    },
    [camera, controls]
  );

  // The whole-assembly bounds set the standing camera distance: per-step
  // transitions keep this distance and only rotate, so the zoom never jumps
  // between steps. Prefer the graph's seated bounds — measuring the scene
  // mid-animation would inflate the box with displaced parts.
  const getAssemblyBox = useCallback((): Box3 => {
    if (assemblyBounds) {
      return new Box3(
        new Vector3(...(assemblyBounds.min as [number, number, number])),
        new Vector3(...(assemblyBounds.max as [number, number, number]))
      );
    }
    return new Box3().setFromObject(scene);
  }, [assemblyBounds, scene]);

  // Initial framing of the whole assembly
  const framedSceneRef = useRef<Object3D | null>(null);
  useEffect(() => {
    if (!controls || framedSceneRef.current === scene) return;
    framedSceneRef.current = scene;
    frameBox(getAssemblyBox());
  }, [scene, controls, frameBox, getAssemblyBox]);

  // Smoothly approached camera pose (per-step rotation); cleared when the
  // user grabs the controls so they can take over mid-transition
  const desiredPoseRef = useRef<{ position: Vector3; target: Vector3 } | null>(
    null
  );

  useEffect(() => {
    if (!controls) return;
    const cancel = () => {
      desiredPoseRef.current = null;
    };
    controls.addEventListener("start", cancel);
    return () => controls.removeEventListener("start", cancel);
  }, [controls]);

  // Transition by orbiting around the target — the view direction rotates
  // and the distance eases, so the model never leaves the frame the way a
  // straight-line position lerp can.
  useFrame((_, delta) => {
    const desired = desiredPoseRef.current;
    if (!desired || !controls) return;
    const alpha = 1 - Math.exp(-delta * 4);

    controls.target.lerp(desired.target, alpha);

    const currentOffset = camera.position.clone().sub(controls.target);
    const desiredOffset = desired.position.clone().sub(desired.target);
    const currentDistance = Math.max(currentOffset.length(), 1e-3);
    const desiredDistance = Math.max(desiredOffset.length(), 1e-3);

    const direction = currentOffset
      .divideScalar(currentDistance)
      .lerp(desiredOffset.divideScalar(desiredDistance), alpha);
    if (direction.lengthSq() < 1e-6) {
      // Opposite directions: nudge through the desired side
      direction.copy(desired.position).sub(desired.target).normalize();
    }
    direction.normalize();

    const distance =
      currentDistance + (desiredDistance - currentDistance) * alpha;
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    controls.update();

    if (
      camera.position.distanceToSquared(desired.position) < 0.01 &&
      controls.target.distanceToSquared(desired.target) < 0.01
    ) {
      desiredPoseRef.current = null;
    }
  });

  // Frame externally highlighted parts when the highlight changes (but keep
  // the user's camera when the highlight is cleared)
  const framedHighlightRef = useRef<string>("");
  useEffect(() => {
    const key = [...highlightedSet].sort().join("|");
    if (key === framedHighlightRef.current) return;
    framedHighlightRef.current = key;
    if (highlightedSet.size === 0) return;

    const box = new Box3();
    for (const nodeId of highlightedSet) {
      const node = nodesById.get(nodeId);
      if (node) box.expandByObject(node);
    }
    frameBox(box);
  }, [highlightedSet, nodesById, frameBox]);

  // Per-step camera: explicit pose wins; otherwise keep the standing
  // whole-assembly distance and rotate so the active part and its travel
  // face the camera — the zoom stays steady, only the view angle changes.
  useEffect(() => {
    const step = steps[activeStepIndex];
    if (!step || !controls) return;

    if (step.camera) {
      desiredPoseRef.current = {
        position: new Vector3(...step.camera.position),
        target: new Vector3(...step.camera.target)
      };
      if (camera instanceof PerspectiveCamera) {
        camera.fov = step.camera.fov;
        camera.updateProjectionMatrix();
      }
      return;
    }

    if (step.partNodeIds.length === 0) return;

    const assemblyBox = getAssemblyBox();
    if (assemblyBox.isEmpty()) return;
    const center = assemblyBox.getCenter(new Vector3());
    const radius = assemblyBox.getSize(new Vector3()).length() / 2;
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
    const distance = Math.max(
      (radius / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.25,
      radius * 2
    );

    const partBox = new Box3();
    for (const nodeId of step.partNodeIds) {
      const node = nodesById.get(nodeId);
      if (node) partBox.expandByObject(node);
    }
    if (partBox.isEmpty()) return;
    const partCenter = partBox.getCenter(new Vector3());

    // Aim mostly at the assembly (context) with a nudge toward the part
    const target = center.clone().lerp(partCenter, 0.3);

    // Where the action happens: the seated pose and the travel midpoint
    const motionDirection = insertionDirection(step.motion);
    const lookPoints = [partCenter];
    const startOffset = insertionStartOffset(step.motion);
    if (startOffset) {
      lookPoints.push(partCenter.clone().addScaledVector(startOffset, 0.5));
    }

    // Occluders: everything that renders during this step, weighted by how
    // strongly it hides the action (ghosted future parts barely count)
    const stepParts = new Set(step.partNodeIds);
    const occluders: { min: Vector3; max: Vector3; weight: number }[] = [];
    for (const leaf of leafBounds ?? []) {
      if (stepParts.has(leaf.nodeId)) continue;
      if (hiddenSet.has(leaf.nodeId)) continue;
      const leafStep = stepIndexByNode.get(leaf.nodeId);
      const isFuture = leafStep !== undefined && leafStep > activeStepIndex;
      if (isFuture && futureMode === "hidden") continue;
      occluders.push({
        min: new Vector3(...(leaf.bbox.min as [number, number, number])),
        max: new Vector3(...(leaf.bbox.max as [number, number, number])),
        weight: isFuture && futureMode === "ghost" ? 0.3 : 1
      });
    }

    // Candidate view directions: two elevation rings around the up axis,
    // plus the current view. Pick the one that sees the action with the
    // fewest parts in the way, preferring lateral travel and small turns.
    const up = camera.up.clone().normalize();
    let basisU = new Vector3().crossVectors(up, new Vector3(0, 0, 1));
    if (basisU.lengthSq() < 1e-6) {
      basisU = new Vector3().crossVectors(up, new Vector3(1, 0, 0));
    }
    basisU.normalize();
    const basisV = new Vector3().crossVectors(up, basisU).normalize();

    const currentDirection = camera.position
      .clone()
      .sub(controls.target)
      .normalize();
    const candidates: Vector3[] = [];
    if (currentDirection.lengthSq() > 1e-6) candidates.push(currentDirection);
    for (const elevation of [0.3, 0.55]) {
      const horizontal = Math.sqrt(1 - elevation * elevation);
      for (let i = 0; i < 8; i++) {
        const azimuth = (i / 8) * Math.PI * 2;
        candidates.push(
          new Vector3()
            .addScaledVector(basisU, Math.cos(azimuth) * horizontal)
            .addScaledVector(basisV, Math.sin(azimuth) * horizontal)
            .addScaledVector(up, elevation)
            .normalize()
        );
      }
    }

    let bestDirection = candidates[0] ?? new Vector3(1, 1, 1).normalize();
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const eye = target.clone().addScaledVector(candidate, distance);
      let score = 0;
      // How much is in the way of seeing the action?
      for (const point of lookPoints) {
        for (const occluder of occluders) {
          if (segmentIntersectsBox(eye, point, occluder.min, occluder.max)) {
            score += occluder.weight;
          }
        }
      }
      // Prefer travel running across the screen, not into it
      if (motionDirection) {
        score +=
          4 * Math.max(0, Math.abs(candidate.dot(motionDirection)) - 0.6);
      }
      // Prefer small turns from the current view
      score += 1.75 * (1 - candidate.dot(currentDirection));
      if (score < bestScore) {
        bestScore = score;
        bestDirection = candidate;
      }
    }

    desiredPoseRef.current = {
      position: target.clone().addScaledVector(bestDirection, distance),
      target
    };
  }, [
    steps,
    activeStepIndex,
    nodesById,
    camera,
    controls,
    getAssemblyBox,
    leafBounds,
    hiddenSet,
    stepIndexByNode,
    futureMode
  ]);

  // --- Selection -------------------------------------------------------------

  const handleClick = useCallback(
    (clickEvent: ThreeEvent<MouseEvent>) => {
      if (readOnly || !onSelectParts) return;
      clickEvent.stopPropagation();
      const nodeId = findNodeId(clickEvent.object);
      if (!nodeId) return;
      setSelectedIds((previous) => {
        const next = clickEvent.nativeEvent.shiftKey
          ? new Set(previous)
          : new Set<string>();
        if (clickEvent.nativeEvent.shiftKey && next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        onSelectParts([...next]);
        return next;
      });
    },
    [readOnly, onSelectParts]
  );

  const handlePointerMissed = useCallback(
    (pointerEvent: MouseEvent) => {
      if (readOnly || !onSelectParts || pointerEvent.shiftKey) return;
      setSelectedIds((previous) => {
        if (previous.size === 0) return previous;
        onSelectParts([]);
        return new Set();
      });
    },
    [readOnly, onSelectParts]
  );

  return (
    <primitive
      object={scene}
      onClick={handleClick}
      onPointerMissed={handlePointerMissed}
    />
  );
}

/**
 * Does the open segment from `origin` to `end` pass through the AABB?
 * Slab clipping; ignores grazing contact right at the endpoint so a box
 * around the look-at point does not count as occluding itself.
 */
function segmentIntersectsBox(
  origin: Vector3,
  end: Vector3,
  min: Vector3,
  max: Vector3
): boolean {
  let tMin = 0;
  let tMax = 0.98; // stop just short of the look-at point
  const axes = ["x", "y", "z"] as const;
  for (const axis of axes) {
    const delta = end[axis] - origin[axis];
    if (Math.abs(delta) < 1e-9) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return false;
      continue;
    }
    let tNear = (min[axis] - origin[axis]) / delta;
    let tFar = (max[axis] - origin[axis]) / delta;
    if (tNear > tFar) [tNear, tFar] = [tFar, tNear];
    tMin = Math.max(tMin, tNear);
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * Where a part starts relative to its seated pose for the given insertion
 * motion. Null when the motion does not translate the part.
 */
function insertionStartOffset(motion: AssemblyStep["motion"]): Vector3 | null {
  switch (motion.type) {
    case "linear": {
      const direction = new Vector3(...motion.direction).normalize();
      return direction.multiplyScalar(-motion.distance);
    }
    case "L": {
      const offset = new Vector3();
      for (const segment of motion.segments) {
        const direction = new Vector3(...segment.direction).normalize();
        offset.addScaledVector(direction, -segment.distance);
      }
      return offset;
    }
    case "helix": {
      const axis = new Vector3(...motion.axis).normalize();
      const travel = motion.approach + motion.pitch * motion.turns;
      return axis.multiplyScalar(-travel);
    }
    default:
      return null;
  }
}

/**
 * The dominant travel direction of an insertion motion (used to pick a
 * camera angle where the motion reads laterally). Null for motions that
 * do not translate the part.
 */
function insertionDirection(motion: AssemblyStep["motion"]): Vector3 | null {
  switch (motion.type) {
    case "linear":
      return new Vector3(...motion.direction).normalize();
    case "L": {
      let longest: Vector3 | null = null;
      let longestDistance = 0;
      for (const segment of motion.segments) {
        if (Math.abs(segment.distance) > longestDistance) {
          longestDistance = Math.abs(segment.distance);
          longest = new Vector3(...segment.direction);
        }
      }
      return longest ? longest.normalize() : null;
    }
    case "helix":
      return new Vector3(...motion.axis).normalize();
    default:
      return null;
  }
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function findNodeId(object: Object3D): string | null {
  let current: Object3D | null = object;
  while (current) {
    const nodeId = current.userData?.nodeId;
    if (typeof nodeId === "string" && nodeId.length > 0) return nodeId;
    current = current.parent;
  }
  return null;
}

function getOverride(
  mesh: Mesh,
  cache: Map<Mesh, MaterialOverrides>,
  kind: OverrideKind
): Material | Material[] {
  let entry = cache.get(mesh);
  if (!entry) {
    entry = { original: mesh.material };
    cache.set(mesh, entry);
  }
  let override = entry[kind];
  if (!override) {
    const emissiveColor =
      kind === "highlight"
        ? HIGHLIGHT_COLOR
        : kind === "selected"
          ? SELECTED_COLOR
          : EXTERNAL_COLOR;
    override =
      kind === "ghost"
        ? cloneAsGhost(entry.original)
        : cloneWithEmissive(entry.original, emissiveColor);
    entry[kind] = override;
  }
  return override;
}

/**
 * Ghosted future part: the original material at low opacity so parts keep
 * their color while reading as "not installed yet".
 */
function cloneAsGhost(material: Material | Material[]): Material | Material[] {
  const clone = (source: Material): Material => {
    const cloned = source.clone();
    cloned.transparent = true;
    cloned.opacity = GHOST_OPACITY;
    cloned.depthWrite = false;
    return cloned;
  };
  return Array.isArray(material) ? material.map(clone) : clone(material);
}

function cloneWithEmissive(
  material: Material | Material[],
  emissiveColor: number
): Material | Material[] {
  const clone = (source: Material): Material => {
    const cloned = source.clone();
    if (cloned instanceof MeshStandardMaterial) {
      cloned.emissive = new Color(emissiveColor);
      cloned.emissiveIntensity = 0.4;
    } else if ("color" in cloned) {
      (cloned as MeshBasicMaterial).color.lerp(new Color(emissiveColor), 0.5);
    }
    return cloned;
  };
  return Array.isArray(material) ? material.map(clone) : clone(material);
}

function disposeMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}

function OverlayNavButton({
  side,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  side: "left" | "right";
}) {
  return (
    <button
      type="button"
      className={cn(
        "absolute top-1/2 z-10 flex h-20 w-12 -translate-y-1/2 items-center justify-center rounded-lg",
        "text-foreground/30 transition-colors hover:bg-background/40 hover:text-foreground/90",
        "disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "left-2" : "right-2",
        className
      )}
      {...props}
    >
      <svg
        className="h-8 w-8"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d={side === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function ControlButton({
  isActive = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
        isActive && "bg-accent text-accent-foreground",
        className
      )}
      {...props}
    />
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5.14v13.72a1 1 0 001.5.87l11-6.86a1 1 0 000-1.74l-11-6.86a1 1 0 00-1.5.87z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function GhostIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="3 2"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function HiddenIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0112 5c7 0 10 7 10 7a16.7 16.7 0 01-3.2 4.2M6.6 6.6A16.4 16.4 0 002 12s3 7 10 7a9.9 9.9 0 004.3-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.9 9.9a3 3 0 004.2 4.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SolidIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 12l8-4.5M12 12L4 7.5M12 12v9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
