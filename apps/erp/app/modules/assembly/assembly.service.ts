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

export async function getAssemblyInstructionStepRequirements(
  client: SupabaseClient<Database>,
  stepIds: string[]
) {
  if (stepIds.length === 0) {
    return { data: [], error: null };
  }
  return client
    .from("assemblyInstructionStepRequirement")
    .select("*, item(id, name, readableIdWithRevision)")
    .in("stepId", stepIds)
    .order("sortOrder", { ascending: true });
}

export async function upsertAssemblyInstructionStepRequirement(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    stepId: string;
    type: (typeof assemblyRequirementTypes)[number];
    itemId?: string | null;
    name?: string | null;
    text?: string | null;
    severity?: (typeof assemblyNoteSeverities)[number] | null;
    filePath?: string | null;
    quantity?: number;
    sortOrder?: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  // Snapshot the catalog item name so display never needs a join and
  // survives item deletion
  let name = data.name ?? null;
  if (!name && data.itemId) {
    const item = await client
      .from("item")
      .select("name")
      .eq("id", data.itemId)
      .single();
    name = item.data?.name ?? null;
  }

  if (data.id) {
    return client
      .from("assemblyInstructionStepRequirement")
      .update({
        itemId: data.itemId ?? null,
        name,
        text: data.text ?? null,
        severity: data.severity ?? null,
        ...(data.filePath !== undefined ? { filePath: data.filePath } : {}),
        ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
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
      stepId: data.stepId,
      type: data.type,
      itemId: data.itemId ?? null,
      name,
      text: data.text ?? null,
      severity: data.severity ?? null,
      filePath: data.filePath ?? null,
      quantity: data.quantity ?? 1,
      sortOrder:
        data.sortOrder ?? (await getNextRequirementSortOrder(client, data)),
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

async function getNextRequirementSortOrder(
  client: SupabaseClient<Database>,
  data: { stepId: string; type: (typeof assemblyRequirementTypes)[number] }
) {
  const last = await client
    .from("assemblyInstructionStepRequirement")
    .select("sortOrder")
    .eq("stepId", data.stepId)
    .eq("type", data.type)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (last.data?.sortOrder ?? 0) + 1;
}

export async function getAssemblyInstructionStepRequirement(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("assemblyInstructionStepRequirement")
    .select("*")
    .eq("id", id)
    .single();
}

export async function updateAssemblyInstructionStepRequirementOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("assemblyInstructionStepRequirement")
        .set({ sortOrder, updatedBy, updatedAt: new Date().toISOString() })
        .where("id", "=", id)
        .execute();
    }
  });
}

export async function deleteAssemblyInstructionStepRequirement(
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
    .order("name", { ascending: true });
}

export async function upsertAssemblyStandardNote(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    name: string;
    content: string;
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
        content: data.content,
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
      content: data.content,
      severity: data.severity,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

export async function deleteAssemblyStandardNote(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyStandardNote").delete().eq("id", id);
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
