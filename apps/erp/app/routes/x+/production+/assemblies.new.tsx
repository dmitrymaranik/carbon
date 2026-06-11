import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  assemblyInstructionFromItemValidator,
  getValidModelForItem,
  upsertAssemblyInstruction
} from "~/modules/production";
import AssemblyInstructionForm from "~/modules/production/ui/Assemblies/AssemblyInstructionForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "production"
  });

  const url = new URL(request.url);

  return {
    initialValues: {
      name: "",
      itemId: url.searchParams.get("itemId") ?? ""
    }
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const validation = await validator(
    assemblyInstructionFromItemValidator
  ).validate(await request.formData());

  if (validation.error) {
    return validationError(validation.error);
  }

  const { itemId, name, modelUploadId } = validation.data;

  // An explicitly provided model (e.g. from the part details page) wins when
  // it has been processed; otherwise derive it from the item's CAD files
  let model: { id: string } | null = null;

  if (modelUploadId) {
    const explicit = await client
      .from("modelUpload")
      .select("id, processingStatus, glbPath, graphPath")
      .eq("id", modelUploadId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (
      explicit.data?.processingStatus === "Success" &&
      explicit.data.glbPath &&
      explicit.data.graphPath
    ) {
      model = explicit.data;
    }
  }

  const derived = await getValidModelForItem(client, itemId, companyId);
  if (!derived.item) {
    return data(
      {},
      await flash(request, error(null, "Failed to load the selected item"))
    );
  }
  if (!model) model = derived.model;

  if (!model) {
    return data(
      {},
      await flash(
        request,
        error(
          null,
          "The selected item has no processed 3D model. Upload a STEP file on the item's Model tab first."
        )
      )
    );
  }

  const create = await upsertAssemblyInstruction(client, {
    name: name?.trim() || derived.item.name || "Assembly",
    modelUploadId: model.id,
    itemId,
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
  const { initialValues } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <AssemblyInstructionForm
      initialValues={initialValues}
      onClose={() => navigate(path.to.assemblyInstructions)}
    />
  );
}
