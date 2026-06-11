import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type {
  assemblyGroupTypes,
  assemblyInstructionStatuses,
  assemblyNoteSeverities,
  assemblyRequirementTypes,
  assemblyStepStatuses,
  cameraSchema,
  fastenerSchema,
  motionSchema
} from "./assembly.models";

export async function getAssemblyInstruction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("assemblyInstruction")
    .select(
      "*, modelUpload(id, name, modelPath, glbPath, graphPath, partCount, processingStatus, processingError)"
    )
    .eq("id", id)
    .single();
}

export async function getAssemblyInstructions(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    search?: string;
    status?: (typeof assemblyInstructionStatuses)[number];
    itemId?: string;
    limit?: number;
    offset?: number;
  }
) {
  let query = client
    .from("assemblyInstruction")
    .select("*, modelUpload(id, name, partCount, processingStatus)", {
      count: "exact"
    })
    .eq("companyId", args.companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }
  if (args.itemId) {
    query = query.eq("itemId", args.itemId);
  }
  if (args.limit) {
    query = query.limit(args.limit);
  }
  if (args.offset) {
    query = query.range(args.offset, args.offset + (args.limit ?? 25) - 1);
  }

  return query.order("updatedAt", { ascending: false, nullsFirst: false });
}

export async function getAssemblyInstructionSteps(
  client: SupabaseClient<Database>,
  assemblyInstructionId: string
) {
  return client
    .from("assemblyInstructionStep")
    .select("*")
    .eq("assemblyInstructionId", assemblyInstructionId)
    .order("sortOrder", { ascending: true });
}

export async function upsertAssemblyInstruction(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    name: string;
    modelUploadId: string;
    itemId?: string | null;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyInstruction")
      .update({
        name: data.name,
        itemId: data.itemId ?? null,
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyInstruction")
    .insert({
      name: data.name,
      modelUploadId: data.modelUploadId,
      itemId: data.itemId ?? null,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

export async function updateAssemblyInstructionStatus(
  client: SupabaseClient<Database>,
  id: string,
  data: {
    status: (typeof assemblyInstructionStatuses)[number];
    updatedBy: string;
  }
) {
  return client
    .from("assemblyInstruction")
    .update({
      status: data.status,
      publishedAt:
        data.status === "Published" ? new Date().toISOString() : undefined,
      updatedBy: data.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

export async function deleteAssemblyInstruction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyInstruction").delete().eq("id", id);
}

export async function upsertAssemblyInstructionStep(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    assemblyInstructionId: string;
    title?: string | null;
    instructionText?: string | null;
    partNodeIds?: string[];
    motion?: z.infer<typeof motionSchema>;
    camera?: z.infer<typeof cameraSchema> | null;
    fastener?: z.infer<typeof fastenerSchema> | null;
    durationSeconds?: number | null;
    sortOrder?: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyInstructionStep")
      .update({
        title: data.title ?? null,
        instructionText: data.instructionText ?? null,
        ...(data.partNodeIds ? { partNodeIds: data.partNodeIds } : {}),
        ...(data.motion ? { motion: data.motion as Json } : {}),
        ...(data.camera !== undefined
          ? { camera: data.camera as Json | null }
          : {}),
        ...(data.fastener !== undefined
          ? { fastener: data.fastener as Json | null }
          : {}),
        ...(data.durationSeconds !== undefined
          ? { durationSeconds: data.durationSeconds }
          : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyInstructionStep")
    .insert({
      assemblyInstructionId: data.assemblyInstructionId,
      title: data.title ?? null,
      instructionText: data.instructionText ?? null,
      partNodeIds: data.partNodeIds ?? [],
      motion: (data.motion ?? { type: "none" }) as Json,
      camera: (data.camera ?? null) as Json | null,
      fastener: (data.fastener ?? null) as Json | null,
      durationSeconds: data.durationSeconds ?? null,
      sortOrder: data.sortOrder ?? (await getNextStepSortOrder(client, data)),
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

async function getNextStepSortOrder(
  client: SupabaseClient<Database>,
  data: { assemblyInstructionId: string }
) {
  const lastStep = await client
    .from("assemblyInstructionStep")
    .select("sortOrder")
    .eq("assemblyInstructionId", data.assemblyInstructionId)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (lastStep.data?.sortOrder ?? 0) + 1;
}

export async function updateAssemblyInstructionStepOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("assemblyInstructionStep")
        .set({ sortOrder, updatedBy, updatedAt: new Date().toISOString() })
        .where("id", "=", id)
        .execute();
    }
  });
}

export async function deleteAssemblyInstructionStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyInstructionStep").delete().eq("id", id);
}

export async function updateAssemblyInstructionStepStatus(
  client: SupabaseClient<Database>,
  id: string,
  data: {
    status: (typeof assemblyStepStatuses)[number];
    updatedBy: string;
  }
) {
  return client
    .from("assemblyInstructionStep")
    .update({
      status: data.status,
      updatedBy: data.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

export async function getAssemblyRequirements(
  client: SupabaseClient<Database>,
  assemblyInstructionId: string
) {
  return client
    .from("assemblyInstructionStepRequirement")
    .select(
      "*, item(id, readableIdWithRevision, name), assemblyInstructionStep!inner(assemblyInstructionId)"
    )
    .eq("assemblyInstructionStep.assemblyInstructionId", assemblyInstructionId)
    .order("sortOrder", { ascending: true });
}

export async function upsertAssemblyRequirement(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    assemblyInstructionStepId: string;
    type: (typeof assemblyRequirementTypes)[number];
    itemId?: string | null;
    text?: string | null;
    filePath?: string | null;
    severity?: (typeof assemblyNoteSeverities)[number] | null;
    sortOrder?: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyInstructionStepRequirement")
      .update({
        itemId: data.itemId ?? null,
        text: data.text ?? null,
        filePath: data.filePath ?? null,
        severity: data.severity ?? null,
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyInstructionStepRequirement")
    .insert({
      assemblyInstructionStepId: data.assemblyInstructionStepId,
      type: data.type,
      itemId: data.itemId ?? null,
      text: data.text ?? null,
      filePath: data.filePath ?? null,
      severity: data.severity ?? null,
      sortOrder: data.sortOrder ?? 1,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

export async function deleteAssemblyRequirement(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("assemblyInstructionStepRequirement")
    .delete()
    .eq("id", id);
}

export async function getAssemblyStandardNotes(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("assemblyStandardNote")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}

export async function upsertAssemblyStandardNote(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    name: string;
    text: string;
    severity: (typeof assemblyNoteSeverities)[number];
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyStandardNote")
      .update({
        name: data.name,
        text: data.text,
        severity: data.severity,
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyStandardNote")
    .insert({
      name: data.name,
      text: data.text,
      severity: data.severity,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

export async function deactivateAssemblyStandardNote(
  client: SupabaseClient<Database>,
  id: string,
  updatedBy: string
) {
  return client
    .from("assemblyStandardNote")
    .update({ active: false, updatedBy, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .single();
}

export async function getAssemblyGroups(
  client: SupabaseClient<Database>,
  assemblyInstructionId: string
) {
  return client
    .from("assemblyGroup")
    .select("*")
    .eq("assemblyInstructionId", assemblyInstructionId)
    .order("name");
}

export async function upsertAssemblyGroup(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    assemblyInstructionId: string;
    name: string;
    type: (typeof assemblyGroupTypes)[number];
    partNodeIds: string[];
    partNumber?: string | null;
    childInstructionId?: string | null;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyGroup")
      .update({
        name: data.name,
        partNodeIds: data.partNodeIds,
        partNumber: data.partNumber ?? null,
        ...(data.childInstructionId !== undefined
          ? { childInstructionId: data.childInstructionId }
          : {}),
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyGroup")
    .insert({
      assemblyInstructionId: data.assemblyInstructionId,
      name: data.name,
      type: data.type,
      partNodeIds: data.partNodeIds,
      partNumber: data.partNumber ?? null,
      childInstructionId: data.childInstructionId ?? null,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

export async function deleteAssemblyGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyGroup").delete().eq("id", id);
}

/**
 * Latest successful motion plan for a model. The editor uses plan.json to
 * auto-fill step motions and to generate draft step sequences.
 */
export async function getLatestAssemblyPlan(
  client: SupabaseClient<Database>,
  modelUploadId: string
) {
  return client
    .from("assemblyPlanJob")
    .select("id, planPath, stats, createdAt")
    .eq("modelUploadId", modelUploadId)
    .eq("kind", "plan")
    .eq("status", "Success")
    .not("planPath", "is", null)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
}
