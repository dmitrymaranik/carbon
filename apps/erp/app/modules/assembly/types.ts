import type {
  getAssemblyInstruction,
  getAssemblyInstructionStepRequirements,
  getAssemblyInstructionSteps,
  getAssemblyInstructions,
  getAssemblyStandardNotes
} from "./assembly.service";

export type AssemblyInstruction = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstruction>>["data"]
>;

export type AssemblyInstructionListItem = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstructions>>["data"]
>[number];

export type AssemblyInstructionStepRow = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstructionSteps>>["data"]
>[number];

export type AssemblyStepRequirement = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstructionStepRequirements>>["data"]
>[number];

export type AssemblyStandardNote = NonNullable<
  Awaited<ReturnType<typeof getAssemblyStandardNotes>>["data"]
>[number];
