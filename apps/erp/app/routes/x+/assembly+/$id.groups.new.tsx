import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyGroupValidator,
  getAssemblyInstruction,
  upsertAssemblyGroup,
  upsertAssemblyInstruction
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { id: assemblyInstructionId } = params;
  if (!assemblyInstructionId) throw new Error("id is not found");

  const validation = await validator(assemblyGroupValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to create group"))
    );
  }

  // Subassemblies get their own child instruction against the same model
  let childInstructionId: string | null = null;
  if (validation.data.type === "Subassembly") {
    const parent = await getAssemblyInstruction(client, assemblyInstructionId);
    if (parent.error || !parent.data.modelUploadId) {
      return data(
        { success: false },
        await flash(
          request,
          error(parent.error, "Failed to load the parent instruction")
        )
      );
    }
    const child = await upsertAssemblyInstruction(client, {
      name: validation.data.name,
      modelUploadId: parent.data.modelUploadId,
      itemId: parent.data.itemId,
      companyId,
      createdBy: userId
    });
    if (child.error || !child.data?.id) {
      return data(
        { success: false },
        await flash(
          request,
          error(child.error, "Failed to create the subassembly instruction")
        )
      );
    }
    childInstructionId = child.data.id;
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is never set on create
  const { id, ...rest } = validation.data;

  const create = await upsertAssemblyGroup(client, {
    ...rest,
    assemblyInstructionId,
    childInstructionId,
    companyId,
    createdBy: userId
  });
  if (create.error) {
    return data(
      { success: false },
      await flash(request, error(create.error, "Failed to create group"))
    );
  }

  return { success: true, id: create.data?.id, childInstructionId };
}
