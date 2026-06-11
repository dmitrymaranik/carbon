import { describe, expect, it } from "vitest";
import type { AssemblyPlan } from "./plan";
import { planMotionForParts } from "./plan";

const lift = {
  type: "linear",
  direction: [0, 0, -1],
  distance: 25
} as const;

const slide = {
  type: "linear",
  direction: [-1, 0, 0],
  distance: 80
} as const;

const plan: AssemblyPlan = {
  version: 1,
  unit: "mm",
  sequence: ["base", "bolt-1", "bolt-2", "cover"],
  parts: {
    base: { motion: { type: "none" } },
    "bolt-1": { motion: lift, confidence: "high" },
    "bolt-2": { motion: lift, confidence: "high" },
    cover: { motion: slide, confidence: "low" }
  },
  warnings: []
};

describe("planMotionForParts", () => {
  it("uses the part's own motion for a single part", () => {
    expect(planMotionForParts(plan, ["bolt-1"])).toEqual({
      motion: lift,
      confidence: "high"
    });
  });

  it("uses the shared motion when all parts agree", () => {
    expect(planMotionForParts(plan, ["bolt-1", "bolt-2"])).toEqual({
      motion: lift,
      confidence: "high"
    });
  });

  it("falls back to the first motion with low confidence on disagreement", () => {
    expect(planMotionForParts(plan, ["bolt-1", "cover"])).toEqual({
      motion: lift,
      confidence: "low"
    });
  });

  it("returns null for unplanned or unknown parts", () => {
    expect(planMotionForParts(plan, ["base"])).toBeNull();
    expect(planMotionForParts(plan, ["missing"])).toBeNull();
    expect(planMotionForParts(plan, [])).toBeNull();
    expect(planMotionForParts(null, ["bolt-1"])).toBeNull();
  });
});
