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
import type { z } from "zod";
import { Combobox, Hidden, Input, Item, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { assemblyInstructionValidator } from "../../assembly.models";

type AssemblyInstructionFormProps = {
  initialValues: z.infer<typeof assemblyInstructionValidator>;
  models: { id: string; name: string | null; partCount: number | null }[];
  open?: boolean;
  onClose: () => void;
};

const AssemblyInstructionForm = ({
  initialValues,
  models,
  open = true,
  onClose
}: AssemblyInstructionFormProps) => {
  const permissions = usePermissions();

  const isDisabled = !permissions.can("create", "assembly");

  const modelOptions = models.map((model) => ({
    value: model.id,
    label:
      typeof model.partCount === "number"
        ? `${model.name ?? model.id} (${model.partCount} parts)`
        : (model.name ?? model.id)
  }));

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
            validator={assemblyInstructionValidator}
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
                <Input name="name" label="Name" />
                <Combobox
                  name="modelUploadId"
                  label="Model"
                  options={modelOptions}
                  helperText="Only models that have been processed for assembly can be selected"
                />
                <Item name="itemId" label="Item" type="Item" />
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
