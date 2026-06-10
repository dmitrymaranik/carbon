import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type {
  assemblyInstructionStatuses,
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
