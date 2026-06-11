import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { useCallback, useEffect, useState } from "react";
import { LuCircleCheck, LuTriangleAlert } from "react-icons/lu";
import type { z } from "zod";
import { Hidden, Input, Item, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { assemblyInstructionFromItemValidator } from "../../production.models";

type ModelStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; label: string }
  | { state: "missing" };

type AssemblyInstructionFormProps = {
  initialValues: z.infer<typeof assemblyInstructionFromItemValidator>;
  open?: boolean;
  onClose: () => void;
};

const AssemblyInstructionForm = ({
  initialValues,
  open = true,
  onClose
}: AssemblyInstructionFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();

  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    state: "idle"
  });

  // Mirrors getValidModelForItem on the server: the item's current model
  // when processed, otherwise its latest successfully processed upload
  const checkModel = useCallback(
    async (itemId: string) => {
      if (!carbon || !itemId) {
        setModelStatus({ state: "idle" });
        return;
      }
      setModelStatus({ state: "loading" });

      const { data: item } = await carbon
        .from("item")
        .select("modelUploadId")
        .eq("id", itemId)
        .maybeSingle();

      let model: {
        name: string;
        partCount: number | null;
      } | null = null;

      if (item?.modelUploadId) {
        const { data: current } = await carbon
          .from("modelUpload")
          .select("id, name, partCount, processingStatus, glbPath, graphPath")
          .eq("id", item.modelUploadId)
          .maybeSingle();
        if (
          current?.processingStatus === "Success" &&
          current.glbPath &&
          current.graphPath
        ) {
          model = current;
        }
      }

      setModelStatus(
        model
          ? {
              state: "ok",
              label:
                typeof model.partCount === "number"
                  ? `${model.name} (${model.partCount} parts)`
                  : model.name
            }
          : { state: "missing" }
      );
    },
    [carbon]
  );

  useEffect(() => {
    if (initialValues.itemId) checkModel(initialValues.itemId);
  }, [initialValues.itemId, checkModel]);

  const isDisabled =
    !permissions.can("create", "production") || modelStatus.state !== "ok";

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={assemblyInstructionFromItemValidator}
            method="post"
            action={path.to.newAssemblyInstruction}
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>New Assembly Instruction</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <VStack spacing={1} className="w-full">
                  <Item
                    name="itemId"
                    label="Item"
                    type="Item"
                    replenishmentSystem="Make"
                    onChange={(selected) => {
                      checkModel(selected?.value ?? "");
                    }}
                  />
                  {modelStatus.state === "loading" && (
                    <p className="text-xs text-muted-foreground">
                      Checking for a processed 3D model…
                    </p>
                  )}
                  {modelStatus.state === "ok" && (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                      <LuCircleCheck className="h-3.5 w-3.5 shrink-0" />
                      Model: {modelStatus.label}
                    </p>
                  )}
                  {modelStatus.state === "missing" && (
                    <p className="flex items-center gap-1.5 text-xs text-yellow-600">
                      <LuTriangleAlert className="h-3.5 w-3.5 shrink-0" />
                      This item has no processed 3D model. Upload a STEP file on
                      the item's Model tab first.
                    </p>
                  )}
                </VStack>
                <Input
                  name="name"
                  label="Name"
                  placeholder="Defaults to the item name"
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default AssemblyInstructionForm;
