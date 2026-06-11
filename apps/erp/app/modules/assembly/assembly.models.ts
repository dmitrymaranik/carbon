import { z } from "zod";
import { zfd } from "zod-form-data";

export const assemblyInstructionStatuses = [
  "Draft",
  "Published",
  "Archived"
] as const;

export const planConfidences = ["high", "low", "manual"] as const;

const vector3 = z.tuple([z.number(), z.number(), z.number()]);
const quaternion = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/**
 * Insertion motion of a step's parts. See
 * docs/specs/animated-work-instructions-contracts.md §4.
 */
export const motionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("linear"),
    direction: vector3,
    distance: z.number().positive()
  }),
  z.object({
    type: z.literal("L"),
    segments: z
      .array(
        z.object({
          direction: vector3,
          distance: z.number().positive()
        })
      )
      .min(2)
      .max(2)
  }),
  z.object({
    type: z.literal("helix"),
    axis: vector3,
    origin: vector3,
    pitch: z.number().positive(),
    turns: z.number().positive(),
    approach: z.number().nonnegative()
  }),
  z.object({
    type: z.literal("path"),
    keyframes: z
      .array(
        z.object({
          t: z.number().min(0).max(1),
          position: vector3,
          quaternion
        })
      )
      .min(2)
  }),
  z.object({ type: z.literal("none") })
]);

export const cameraSchema = z.object({
  position: vector3,
  target: vector3,
  fov: z.number().positive()
});

export const fastenerSchema = z.object({
  spec: z.string().optional(),
  count: z.number().int().positive().optional(),
  torqueNm: z.number().positive().optional(),
  tool: z.string().optional()
});

const jsonField = (schema: z.ZodTypeAny) =>
  z.preprocess((raw) => {
    if (typeof raw !== "string") return raw;
    if (raw.trim() === "") return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }, schema);

export const assemblyInstructionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  modelUploadId: z.string().min(1, { message: "Model is required" }),
  itemId: zfd.text(z.string().optional())
});

export const assemblyInstructionStatusValidator = z.object({
  status: z.enum(assemblyInstructionStatuses)
});

export const assemblyInstructionStepValidator = z.object({
  id: zfd.text(z.string().optional()),
  assemblyInstructionId: z.string().min(1),
  title: zfd.text(z.string().optional()),
  instructionText: zfd.text(z.string().optional()),
  partNodeIds: jsonField(z.array(z.string()).optional()),
  motion: jsonField(motionSchema.optional()),
  camera: jsonField(cameraSchema.nullable().optional()),
  fastener: jsonField(fastenerSchema.nullable().optional()),
  durationSeconds: zfd.numeric(z.number().positive().optional())
});

export const assemblyInstructionStepOrderValidator = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: z.number()
      })
    )
    .min(1)
});

export const assemblyStepStatuses = ["todo", "review", "done"] as const;

export const assemblyStepStatusValidator = z.object({
  stepId: z.string().min(1),
  status: z.enum(assemblyStepStatuses)
});

export const assemblyRequirementTypes = [
  "tool",
  "fixture",
  "consumable",
  "note",
  "media"
] as const;

export const assemblyNoteSeverities = ["info", "caution", "warning"] as const;

export const assemblyRequirementValidator = z.object({
  id: zfd.text(z.string().optional()),
  assemblyInstructionStepId: z.string().min(1),
  type: z.enum(assemblyRequirementTypes),
  itemId: zfd.text(z.string().optional()),
  text: zfd.text(z.string().optional()),
  filePath: zfd.text(z.string().optional()),
  severity: zfd.text(z.enum(assemblyNoteSeverities).optional())
});

export const assemblyStandardNoteValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  text: z.string().min(1, { message: "Text is required" }),
  severity: z.enum(assemblyNoteSeverities).default("info")
});

export const assemblyGroupTypes = [
  "cluster",
  "kit",
  "combination",
  "subassembly"
] as const;

export const assemblyGroupValidator = z.object({
  id: zfd.text(z.string().optional()),
  assemblyInstructionId: z.string().min(1),
  name: z.string().min(1, { message: "Name is required" }),
  type: z.enum(assemblyGroupTypes),
  partNodeIds: jsonField(z.array(z.string()).min(1)),
  partNumber: zfd.text(z.string().optional())
});

export type Motion = z.infer<typeof motionSchema>;
export type CameraPose = z.infer<typeof cameraSchema>;
export type Fastener = z.infer<typeof fastenerSchema>;
