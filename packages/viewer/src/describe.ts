import { type AssemblyGraphIndex, groupPartNodeIds } from "./graph";
import type { AssemblyStep } from "./types";

/**
 * Display title for a step. An explicit title always wins; otherwise the
 * title is derived from the step's parts and fastener, e.g.
 * "Add Seat Rail Clamp, M5 SHCS (×4)". Returns null when there is nothing
 * to derive from (no title, no known parts, no fastener).
 */
export function describeStep(
  step: Pick<AssemblyStep, "title" | "partNodeIds" | "fastener">,
  index: AssemblyGraphIndex | null
): string | null {
  if (step.title && step.title.trim().length > 0) return step.title;

  const groups = index ? groupPartNodeIds(step.partNodeIds, index) : [];
  const fastenerSpec = step.fastener?.spec?.trim();

  if (groups.length === 0 && !fastenerSpec) return null;

  const verb =
    groups.length === 0 ? "Install" : groups.length === 1 ? "Add" : "Assemble";

  const segments = groups.map((group) =>
    group.count > 1 ? `${group.name} (×${group.count})` : group.name
  );
  if (fastenerSpec) {
    const count = step.fastener?.count;
    segments.push(
      count && count > 1 ? `${fastenerSpec} (×${count})` : fastenerSpec
    );
  }

  return `${verb} ${segments.join(", ")}`;
}
