import type { Json } from "@carbon/database";
import { Button, ClientOnly, Spinner } from "@carbon/react";
import type {
  AssemblyStep,
  CameraPose,
  Fastener,
  Motion
} from "@carbon/viewer";
import { AssemblyPlayer } from "@carbon/viewer";
import { Trans } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { getPrivateUrl } from "~/utils/path";

export type AssemblyInstructionData = {
  name: string | null;
  glbPath: string;
  graphPath: string;
  steps: {
    id: string;
    title: string | null;
    instructionText: string | null;
    partNodeIds: string[];
    motion: Json;
    camera: Json | null;
    fastener: Json | null;
  }[];
};

const motionTypes = ["linear", "L", "helix", "path", "none"];

function toViewerStep(
  step: AssemblyInstructionData["steps"][number]
): AssemblyStep {
  const motion = step.motion as Motion | null;
  return {
    id: step.id,
    title: step.title,
    instructionText: step.instructionText,
    partNodeIds: step.partNodeIds ?? [],
    motion:
      motion && typeof motion === "object" && motionTypes.includes(motion.type)
        ? motion
        : { type: "none" },
    camera: (step.camera as CameraPose | null) ?? null,
    fastener: (step.fastener as Fastener | null) ?? null
  };
}

type AssemblyInstructionsProps = {
  assembly: AssemblyInstructionData;
  mode: "light" | "dark";
};

export function AssemblyInstructions({
  assembly,
  mode
}: AssemblyInstructionsProps) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const steps = useMemo(
    () => assembly.steps.map(toViewerStep),
    [assembly.steps]
  );

  const stepCount = steps.length;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">
        <ClientOnly
          fallback={
            <div className="flex h-full w-full items-center justify-center">
              <Spinner className="h-10 w-10" />
            </div>
          }
        >
          {() => (
            <AssemblyPlayer
              glbUrl={getPrivateUrl(assembly.glbPath)}
              graphUrl={getPrivateUrl(assembly.graphPath)}
              steps={steps}
              activeStepIndex={activeStepIndex}
              onStepChange={setActiveStepIndex}
              readOnly
              mode={mode}
              className="h-full"
            />
          )}
        </ClientOnly>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-border bg-background p-3">
        <Button
          size="lg"
          variant="secondary"
          className="h-16 text-lg active:scale-[0.96] transition-transform"
          leftIcon={<LuChevronLeft className="size-6" />}
          isDisabled={activeStepIndex <= 0}
          onClick={() => setActiveStepIndex((index) => Math.max(index - 1, 0))}
        >
          <Trans>Previous</Trans>
        </Button>
        <Button
          size="lg"
          className="h-16 text-lg active:scale-[0.96] transition-transform"
          rightIcon={<LuChevronRight className="size-6" />}
          isDisabled={activeStepIndex >= stepCount - 1}
          onClick={() =>
            setActiveStepIndex((index) => Math.min(index + 1, stepCount - 1))
          }
        >
          <Trans>Next</Trans>
        </Button>
      </div>
    </div>
  );
}
