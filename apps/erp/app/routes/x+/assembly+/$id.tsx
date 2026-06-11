import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { ClientOnly, Spinner, useMode } from "@carbon/react";
import type { AssemblyGraph } from "@carbon/viewer";
import { AssemblyPlayer, indexAssemblyGraph } from "@carbon/viewer";
import { msg } from "@lingui/core/macro";
import { useCallback, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useParams } from "react-router";
import { Empty } from "~/components";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { usePermissions } from "~/hooks";
import {
  assemblyInstructionValidator,
  getAssemblyInstruction,
  getAssemblyInstructionStepRequirements,
  getAssemblyInstructionSteps,
  getAssemblyStandardNotes,
  toViewerStep,
  upsertAssemblyInstruction
} from "~/modules/production";
import AssemblyInstructionExplorer from "~/modules/production/ui/Assemblies/AssemblyInstructionExplorer";
import AssemblyInstructionHeader from "~/modules/production/ui/Assemblies/AssemblyInstructionHeader";
import AssemblyInstructionProperties from "~/modules/production/ui/Assemblies/AssemblyInstructionProperties";
import type { Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Assemblies`,
  to: path.to.assemblyInstructions,
  module: "production"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [instruction, steps, standardNotes] = await Promise.all([
    getAssemblyInstruction(client, id),
    getAssemblyInstructionSteps(client, id),
    getAssemblyStandardNotes(client, companyId)
  ]);

  if (instruction.error) {
    throw redirect(
      path.to.assemblyInstructions,
      await flash(
        request,
        error(instruction.error, "Failed to load assembly instruction")
      )
    );
  }

  const requirements = await getAssemblyInstructionStepRequirements(
    client,
    (steps.data ?? []).map((step) => step.id)
  );

  return {
    instruction: instruction.data,
    steps: steps.data ?? [],
    requirements: requirements.data ?? [],
    standardNotes: standardNotes.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(assemblyInstructionValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await upsertAssemblyInstruction(client, {
    ...validation.data,
    id,
    companyId,
    createdBy: userId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update assembly instruction")
      )
    );
  }

  throw redirect(
    path.to.assemblyInstruction(id),
    await flash(request, success("Updated assembly instruction"))
  );
}

export default function AssemblyInstructionRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { instruction, steps, requirements, standardNotes } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const mode = useMode();

  const isDisabled =
    instruction.status !== "Draft" || !permissions.can("update", "production");

  const [selectedStepId, setSelectedStepId] = useState<string | null>(
    steps[0]?.id ?? null
  );
  const [draftPartNodeIds, setDraftPartNodeIds] = useState<string[] | null>(
    null
  );
  const [graph, setGraph] = useState<AssemblyGraph | null>(null);
  const graphIndex = useMemo(
    () => (graph ? indexAssemblyGraph(graph) : null),
    [graph]
  );
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([]);

  const selectedStep =
    steps.find((step) => step.id === selectedStepId) ?? steps[0] ?? null;
  const activeStepIndex = selectedStep
    ? steps.findIndex((step) => step.id === selectedStep.id)
    : 0;

  const onSelectStep = useCallback((stepId: string) => {
    setSelectedStepId(stepId);
    setDraftPartNodeIds(null);
  }, []);

  const viewerSteps = useMemo(() => steps.map(toViewerStep), [steps]);

  const modelUpload = instruction.modelUpload;
  const glbPath = modelUpload?.glbPath;
  const graphPath = modelUpload?.graphPath;

  return (
    <PanelProvider key={id}>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <AssemblyInstructionHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex grow overflow-hidden">
            <ResizablePanels
              explorer={
                <AssemblyInstructionExplorer
                  steps={steps}
                  selectedStepId={selectedStep?.id ?? null}
                  isDisabled={isDisabled}
                  graphIndex={graphIndex}
                  onSelectStep={onSelectStep}
                  onHighlightParts={setHighlightedNodeIds}
                />
              }
              content={
                <div className="bg-background h-[calc(100dvh-99px)] w-full">
                  {glbPath && graphPath ? (
                    <ClientOnly
                      fallback={
                        <div className="flex h-full w-full items-center justify-center">
                          <Spinner className="h-10 w-10" />
                        </div>
                      }
                    >
                      {() => (
                        <AssemblyPlayer
                          glbUrl={getPrivateUrl(glbPath)}
                          graphUrl={getPrivateUrl(graphPath)}
                          steps={viewerSteps}
                          activeStepIndex={Math.max(activeStepIndex, 0)}
                          onStepChange={(index) => {
                            const step = steps[index];
                            if (step) onSelectStep(step.id);
                          }}
                          onSelectParts={
                            isDisabled || !selectedStep
                              ? undefined
                              : setDraftPartNodeIds
                          }
                          onGraphLoaded={setGraph}
                          highlightedNodeIds={highlightedNodeIds}
                          readOnly={isDisabled}
                          mode={mode}
                          className="h-full"
                        />
                      )}
                    </ClientOnly>
                  ) : (
                    <Empty>
                      <p className="text-sm text-muted-foreground max-w-[320px] text-center">
                        {modelUpload?.processingStatus === "Failed"
                          ? (modelUpload?.processingError ??
                            "Model processing failed")
                          : "The model has not been processed for assembly instructions yet"}
                      </p>
                    </Empty>
                  )}
                </div>
              }
              properties={
                <AssemblyInstructionProperties
                  key={selectedStep?.id ?? "empty"}
                  step={selectedStep}
                  draftPartNodeIds={draftPartNodeIds}
                  isDisabled={isDisabled}
                  graphIndex={graphIndex}
                  requirements={
                    selectedStep
                      ? requirements.filter(
                          (requirement) =>
                            requirement.stepId === selectedStep.id
                        )
                      : []
                  }
                  standardNotes={standardNotes}
                />
              }
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
