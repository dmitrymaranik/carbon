import type {
  getAssemblyInstruction,
  getAssemblyInstructionSteps,
  getAssemblyInstructions
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
