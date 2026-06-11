import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimationMixer,
  Box3,
  Color,
  LoopRepeat,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Vector3
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { AssemblyViewer } from "./AssemblyViewer";
import { describeStep } from "./describe";
import { indexAssemblyGraph } from "./graph";
import { buildStepClip } from "./motion";
import type { AssemblyGraph, AssemblyStep } from "./types";
import { useAssembly } from "./useAssembly";
import { cn } from "./utils";

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
  /** Disables part selection (MES playback) */
  readOnly?: boolean;
  mode?: "dark" | "light";
  className?: string;
};

/**
 * Animated assembly playback per the assembly contracts (section 5):
 * - parts of steps before the active step are shown solid at their final pose
 * - parts of the active step loop their insertion motion (with a short hold
 *   at the seated pose)
 * - parts of later steps are hidden, or ghosted when x-ray is on
 * - parts in no step (base/fixture parts) are always shown solid
 */
export function AssemblyPlayer({
  glbUrl,
  graphUrl,
  steps,
  activeStepIndex,
  onStepChange,
  onSelectParts,
  onGraphLoaded,
  readOnly = false,
  mode = "dark",
  className
}: AssemblyPlayerProps) {
  const { scene, nodesById, graph, isLoading, error } = useAssembly(
    glbUrl,
    graphUrl
  );
  const [isPlaying, setIsPlaying] = useState(true);
  const [xray, setXray] = useState(false);

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

  const goToStep = useCallback(
    (index: number) => {
      if (index < 0 || index >= stepCount) return;
      onStepChange?.(index);
    },
    [onStepChange, stepCount]
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
              steps={steps}
              activeStepIndex={clampedIndex}
              isPlaying={isPlaying}
              xray={xray}
              readOnly={readOnly}
              onSelectParts={onSelectParts}
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
          onClick={() => setIsPlaying((playing) => !playing)}
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
        <input
          type="range"
          aria-label="Step"
          className="min-w-0 flex-1 accent-primary"
          min={0}
          max={Math.max(stepCount - 1, 0)}
          step={1}
          value={Math.max(clampedIndex, 0)}
          disabled={stepCount === 0}
          onChange={(changeEvent) => goToStep(Number(changeEvent.target.value))}
        />
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {stepCount > 0 ? `${clampedIndex + 1} / ${stepCount}` : "–"}
        </span>
        <ControlButton
          aria-label="Toggle x-ray"
          aria-pressed={xray}
          isActive={xray}
          onClick={() => setXray((value) => !value)}
        >
          <XRayIcon />
        </ControlButton>
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

type MaterialOverrides = {
  original: Material | Material[];
  ghost: Material;
  highlight: Material | Material[];
  selected: Material | Material[];
};

const HIGHLIGHT_COLOR = 0x3b82f6;
const SELECTED_COLOR = 0xf59e0b;

function AssemblyScene({
  scene,
  nodesById,
  steps,
  activeStepIndex,
  isPlaying,
  xray,
  readOnly,
  onSelectParts
}: {
  scene: Object3D;
  nodesById: Map<string, Object3D>;
  steps: AssemblyStep[];
  activeStepIndex: number;
  isPlaying: boolean;
  xray: boolean;
  readOnly: boolean;
  onSelectParts?: (nodeIds: string[]) => void;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls
  ) as unknown as OrbitControlsImpl | null;
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
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
        disposeMaterials(entry.ghost);
        disposeMaterials(entry.highlight);
        disposeMaterials(entry.selected);
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
        const entry = getOverrides(mesh, overrides);
        mesh.material = visual === "ghost" ? entry.ghost : entry.highlight;
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
            : xray
              ? "ghost"
              : "hidden";
      applyVisual(node, visual);
    }

    for (const nodeId of selectedIds) {
      const node = nodesById.get(nodeId);
      if (!node || !node.visible) continue;
      node.traverse((object) => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        mesh.material = getOverrides(mesh, overrides).selected;
      });
    }
  }, [nodesById, stepIndexByNode, activeStepIndex, xray, selectedIds]);

  // --- Animation -----------------------------------------------------------

  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const actionRef = useRef<ReturnType<AnimationMixer["clipAction"]> | null>(
    null
  );

  useEffect(() => {
    const step = steps[activeStepIndex];
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
    action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
    action.play();
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
  }, [mixer, nodesById, steps, activeStepIndex]);

  useEffect(() => {
    if (actionRef.current) actionRef.current.paused = !isPlaying;
  }, [isPlaying]);

  useFrame((_, delta) => {
    if (isPlaying) mixer.update(delta);
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

  // Initial framing of the whole assembly
  const framedSceneRef = useRef<Object3D | null>(null);
  useEffect(() => {
    if (!controls || framedSceneRef.current === scene) return;
    framedSceneRef.current = scene;
    frameBox(new Box3().setFromObject(scene));
  }, [scene, controls, frameBox]);

  // Per-step camera: explicit pose wins; otherwise auto-frame active parts
  useEffect(() => {
    const step = steps[activeStepIndex];
    if (!step || !controls) return;

    if (step.camera) {
      camera.position.set(...step.camera.position);
      if (camera instanceof PerspectiveCamera) {
        camera.fov = step.camera.fov;
        camera.updateProjectionMatrix();
      }
      controls.target.set(...step.camera.target);
      controls.update();
      return;
    }

    const box = new Box3();
    for (const nodeId of step.partNodeIds) {
      const node = nodesById.get(nodeId);
      if (node) box.expandByObject(node);
    }
    frameBox(box);
  }, [steps, activeStepIndex, nodesById, camera, controls, frameBox]);

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

function findNodeId(object: Object3D): string | null {
  let current: Object3D | null = object;
  while (current) {
    const nodeId = current.userData?.nodeId;
    if (typeof nodeId === "string" && nodeId.length > 0) return nodeId;
    current = current.parent;
  }
  return null;
}

function getOverrides(
  mesh: Mesh,
  cache: Map<Mesh, MaterialOverrides>
): MaterialOverrides {
  let entry = cache.get(mesh);
  if (!entry) {
    const original = mesh.material;
    entry = {
      original,
      ghost: new MeshBasicMaterial({
        color: 0x8c8a8a,
        wireframe: true,
        transparent: true,
        opacity: 0.15,
        depthWrite: false
      }),
      highlight: cloneWithEmissive(original, HIGHLIGHT_COLOR),
      selected: cloneWithEmissive(original, SELECTED_COLOR)
    };
    cache.set(mesh, entry);
  }
  return entry;
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

function XRayIcon() {
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
