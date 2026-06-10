import type { AssemblyStep } from "@carbon/viewer";
import { cameraSchema, fastenerSchema, motionSchema } from "./assembly.models";
import type { AssemblyInstructionStepRow } from "./types";

/**
 * Maps a DB step row to the viewer's step shape. JSONB columns are validated
 * defensively — `path` motions with invalid keyframes throw inside the viewer,
 * so anything that fails the schema falls back to a safe default.
 */
export function toViewerStep(step: AssemblyInstructionStepRow): AssemblyStep {
  const motion = motionSchema.safeParse(step.motion);
  const camera = cameraSchema.safeParse(step.camera);
  const fastener = fastenerSchema.safeParse(step.fastener);

  return {
    id: step.id,
    title: step.title,
    instructionText: step.instructionText,
    partNodeIds: step.partNodeIds ?? [],
    motion: motion.success ? motion.data : { type: "none" },
    camera: camera.success ? camera.data : null,
    fastener: fastener.success ? fastener.data : null
  };
}
