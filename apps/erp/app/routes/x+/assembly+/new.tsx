import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  assemblyInstructionValidator,
  upsertAssemblyInstruction
} from "~/modules/assembly";
import AssemblyInstructionForm from "~/modules/assembly/ui/Assembly/AssemblyInstructionForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "assembly"
  });

  const url = new URL(request.url);

  const models = await client
    .from("modelUpload")
    .select("id, name, partCount")
    .eq("companyId", companyId)
    .eq("processingStatus", "Success")
    .order("createdAt", { ascending: false });

  return {
    models: models.data ?? [],
    initialValues: {
      name: "",
      modelUploadId: url.searchParams.get("modelUploadId") ?? "",
      itemId: url.searchParams.get("itemId") ?? undefined
    }
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "assembly"
  });

  const validation = await validator(assemblyInstructionValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const model = await client
    .from("modelUpload")
    .select("id, processingStatus")
    .eq("id", validation.data.modelUploadId)
    .eq("companyId", companyId)
    .single();

  if (model.error || model.data.processingStatus !== "Success") {
    return data(
      {},
      await flash(
        request,
        error(
          model.error,
          "Model has not been processed for assembly instructions"
        )
      )
    );
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is never set on create
  const { id, ...rest } = validation.data;

  const create = await upsertAssemblyInstruction(client, {
    ...rest,
    companyId,
    createdBy: userId
  });

  if (create.error || !create.data?.id) {
    return data(
      {},
      await flash(
        request,
        error(create.error, "Failed to create assembly instruction")
      )
    );
  }

  throw redirect(
    path.to.assemblyInstruction(create.data.id),
    await flash(request, success("Assembly instruction created"))
  );
}

export default function NewAssemblyInstructionRoute() {
  const { models, initialValues } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <AssemblyInstructionForm
      initialValues={initialValues}
      models={models}
      onClose={() => navigate(path.to.assemblyInstructions)}
    />
  );
}
