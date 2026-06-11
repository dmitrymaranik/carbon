import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { generateAssemblyStepsFromPlan } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await generateAssemblyStepsFromPlan(client, {
    assemblyInstructionId: id,
    companyId,
    userId
  });

  if (result.ok) {
    return data(
      { success: true },
      await flash(
        request,
        success(`Generated ${result.created} steps from the motion plan`)
      )
    );
  }

  if (result.reason === "no-plan" && result.modelUploadId) {
    // No plan yet — kick the planner and let the author retry shortly
    await trigger("assembly-plan", {
      modelUploadId: result.modelUploadId,
      companyId,
      userId
    });
    return data(
      { success: false, planning: true },
      await flash(
        request,
        success(
          "Motion planning started — generate steps again in a minute or two"
        )
      )
    );
  }

  const message =
    result.reason === "steps-exist"
      ? "Steps already exist — delete them before generating from the plan"
      : result.reason === "no-model"
        ? "This instruction has no processed model"
        : (result.message ?? "Failed to generate steps");

  return data({ success: false }, await flash(request, error(null, message)));
}
