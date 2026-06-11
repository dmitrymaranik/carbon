import type { Motion } from "./types";

/**
 * plan.json as written by the geometry service /plan endpoint (see
 * docs/specs/animated-work-instructions-contracts.md). Keys join against
 * graph.json nodeIds and GLB extras.
 */
export type AssemblyPlanPart = {
  /** INSERTION motion (removal reversed) */
  motion: Motion;
  confidence?: "high" | "low";
  removalDirection?: [number, number, number];
  blockedBy?: string[];
};

export type AssemblyPlan = {
  version: 1;
  unit: "mm";
  /** Assembly order (reversed greedy disassembly) */
  sequence: string[];
  parts: Record<string, AssemblyPlanPart>;
  warnings: string[];
};

export type PlannedMotion = {
  motion: Motion;
  confidence: "high" | "low";
};

/**
 * The auto-planned motion for a step's parts, per the contract: a single
 * part uses its own motion; multiple parts use the shared motion when all
 * agree, otherwise the first part's motion with confidence low. Returns
 * null when the plan has nothing useful for these parts.
 */
export function planMotionForParts(
  plan: AssemblyPlan | null,
  partNodeIds: string[]
): PlannedMotion | null {
  if (!plan || partNodeIds.length === 0) return null;

  const entries = partNodeIds
    .map((nodeId) => plan.parts[nodeId])
    .filter(
      (entry): entry is AssemblyPlanPart =>
        Boolean(entry) && entry.motion.type !== "none"
    );
  if (entries.length === 0) return null;

  const first = entries[0];
  if (!first) return null;

  if (entries.length === 1 && partNodeIds.length === 1) {
    return { motion: first.motion, confidence: first.confidence ?? "low" };
  }

  const firstKey = JSON.stringify(first.motion);
  const allAgree =
    entries.length === partNodeIds.length &&
    entries.every((entry) => JSON.stringify(entry.motion) === firstKey);

  if (allAgree) {
    const lowest = entries.some((entry) => entry.confidence !== "high")
      ? "low"
      : "high";
    return { motion: first.motion, confidence: lowest };
  }

  return { motion: first.motion, confidence: "low" };
}
