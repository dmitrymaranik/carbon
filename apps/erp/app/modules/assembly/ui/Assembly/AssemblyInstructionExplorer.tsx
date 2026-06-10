import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDebounce,
  VStack
} from "@carbon/react";
import type { DragControls } from "framer-motion";
import { Reorder, useDragControls } from "framer-motion";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { Empty } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { AssemblyInstructionStepRow } from "../../types";

type AssemblyInstructionExplorerProps = {
  steps: AssemblyInstructionStepRow[];
  selectedStepId: string | null;
  isDisabled: boolean;
  onSelectStep: (stepId: string) => void;
};

export default function AssemblyInstructionExplorer({
  steps,
  selectedStepId,
  isDisabled,
  onSelectStep
}: AssemblyInstructionExplorerProps) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();

  const sortOrderFetcher = useFetcher<{ success: boolean }>();
  const newStepFetcher = useFetcher<{ success: boolean; id?: string }>();

  const [stepToDelete, setStepToDelete] =
    useState<AssemblyInstructionStepRow | null>(null);

  const [sortOrder, setSortOrder] = useState<string[]>(
    steps.map((step) => step.id)
  );

  useEffect(() => {
    setSortOrder(steps.map((step) => step.id));
  }, [steps]);

  // Select the newly created step
  useEffect(() => {
    if (newStepFetcher.data?.success && newStepFetcher.data.id) {
      onSelectStep(newStepFetcher.data.id);
    }
  }, [newStepFetcher.data, onSelectStep]);

  const stepMap = useMemo(
    () =>
      steps.reduce<Record<string, AssemblyInstructionStepRow>>(
        (acc, step) => ({ ...acc, [step.id]: step }),
        {}
      ),
    [steps]
  );

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      const formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.assemblyInstructionStepOrder(id)
      });
    },
    2500,
    true
  );

  const onReorder = (newOrder: string[]) => {
    if (isDisabled) return;

    const updates: Record<string, number> = {};
    newOrder.forEach((stepId, index) => {
      updates[stepId] = index + 1;
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  const onAddStep = () => {
    const formData = new FormData();
    formData.append("assemblyInstructionId", id);
    formData.append("title", `Step ${steps.length + 1}`);
    formData.append("motion", JSON.stringify({ type: "none" }));
    newStepFetcher.submit(formData, {
      method: "post",
      action: path.to.newAssemblyInstructionStep(id)
    });
  };

  return (
    <>
      <VStack
        className="w-full h-[calc(100dvh-99px)] justify-between"
        spacing={0}
      >
        <VStack
          className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {steps.length > 0 ? (
            <Reorder.Group
              axis="y"
              values={sortOrder}
              onReorder={onReorder}
              className="w-full"
              disabled={isDisabled}
            >
              {sortOrder.map((stepId, index) => (
                <DraggableStepItem
                  key={stepId}
                  stepId={stepId}
                  isDisabled={isDisabled}
                >
                  {(dragControls) => (
                    <StepItem
                      step={stepMap[stepId]}
                      index={index}
                      isDisabled={isDisabled}
                      isSelected={stepId === selectedStepId}
                      dragControls={dragControls}
                      onSelect={() => onSelectStep(stepId)}
                      onDelete={() => setStepToDelete(stepMap[stepId])}
                    />
                  )}
                </DraggableStepItem>
              ))}
            </Reorder.Group>
          ) : (
            <Empty>
              {permissions.can("update", "assembly") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={onAddStep}
                >
                  Add Step
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        <div className="w-full flex-none border-t border-border p-4">
          <Button
            className="w-full"
            isDisabled={
              isDisabled ||
              !permissions.can("update", "assembly") ||
              newStepFetcher.state !== "idle"
            }
            isLoading={newStepFetcher.state !== "idle"}
            leftIcon={<LuCirclePlus />}
            variant="secondary"
            onClick={onAddStep}
          >
            Add Step
          </Button>
        </div>
      </VStack>
      {stepToDelete && (
        <ConfirmDelete
          action={path.to.deleteAssemblyInstructionStep(id, stepToDelete.id)}
          name={stepToDelete.title ?? "this step"}
          text={`Are you sure you want to delete the step: ${
            stepToDelete.title ?? stepToDelete.id
          }? This cannot be undone.`}
          onCancel={() => setStepToDelete(null)}
          onSubmit={() => setStepToDelete(null)}
        />
      )}
    </>
  );
}

function DraggableStepItem({
  stepId,
  isDisabled,
  children
}: {
  stepId: string;
  isDisabled: boolean;
  children: (dragControls: DragControls) => ReactNode;
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      key={stepId}
      value={stepId}
      dragListener={false}
      dragControls={dragControls}
    >
      {children(dragControls)}
    </Reorder.Item>
  );
}

type StepItemProps = {
  step?: AssemblyInstructionStepRow;
  index: number;
  isDisabled: boolean;
  isSelected: boolean;
  dragControls?: DragControls;
  onSelect: () => void;
  onDelete: () => void;
};

function StepItem({
  step,
  index,
  isDisabled,
  isSelected,
  dragControls,
  onSelect,
  onDelete
}: StepItemProps) {
  const permissions = usePermissions();
  if (!step) return null;

  const partCount = step.partNodeIds?.length ?? 0;

  return (
    <HStack
      className={cn(
        "group w-full p-2 items-center hover:bg-accent/30 relative border-b bg-card cursor-pointer",
        isSelected && "bg-accent/50 hover:bg-accent/50"
      )}
      onClick={onSelect}
    >
      <IconButton
        aria-label="Drag handle"
        icon={<LuGripVertical />}
        variant="ghost"
        disabled={isDisabled}
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          if (!isDisabled && dragControls) dragControls.start(e);
        }}
        style={{ touchAction: "none" }}
      />
      <VStack spacing={0} className="flex-grow">
        <p className="text-foreground text-sm">
          <span className="text-muted-foreground tabular-nums mr-2">
            {index + 1}.
          </span>
          {step.title ?? "Untitled step"}
        </p>
        <p className="text-muted-foreground text-xs pl-6">
          {partCount} part{partCount === 1 ? "" : "s"}
        </p>
      </VStack>
      {!isDisabled && (
        <div className="absolute right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="More"
                className="opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                icon={<LuEllipsisVertical />}
                variant="solid"
                onClick={(e) => e.stopPropagation()}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                destructive
                disabled={!permissions.can("delete", "assembly")}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                Delete Step
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </HStack>
  );
}
