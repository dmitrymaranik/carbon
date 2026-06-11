import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteAssemblyGroup } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { groupId } = params;
  if (!groupId) throw new Error("groupId is not found");

  // The group's child instruction (subassemblies) is left in place — it may
  // have authored steps; deleting it is a separate, explicit action.
  const deleteGroup = await deleteAssemblyGroup(client, groupId);
  if (deleteGroup.error) {
    return data(
      { success: false },
      await flash(request, error(deleteGroup.error, "Failed to delete group"))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Successfully deleted group"))
  );
}
