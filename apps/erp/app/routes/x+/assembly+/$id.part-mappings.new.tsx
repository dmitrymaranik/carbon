import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertAssemblyPartMapping } from "~/modules/production";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const modelUploadId = formData.get("modelUploadId") as string;
  const geometryHash = formData.get("geometryHash") as string;
  const itemId = formData.get("itemId") as string;

  if (!modelUploadId || !geometryHash || !itemId) {
    return data(
      { success: false },
      await flash(request, error(null, "Missing mapping fields"))
    );
  }

  const upsert = await upsertAssemblyPartMapping(client, {
    modelUploadId,
    geometryHash,
    itemId,
    confidence: "high", // human-confirmed
    companyId,
    createdBy: userId
  });

  if (upsert.error) {
    return data(
      { success: false },
      await flash(request, error(upsert.error, "Failed to map part"))
    );
  }

  return { success: true };
}
