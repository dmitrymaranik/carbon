-- Part grouping for assembly instructions: clusters (visual), kits (picked
-- together), combinations (treated as one part), and subassemblies (own
-- child instruction). Step status and per-step requirements/standard notes
-- live in the two preceding assembly migrations.

CREATE TYPE "assemblyGroupType" AS ENUM (
  'Cluster',
  'Kit',
  'Combination',
  'Subassembly'
);

-- Steps reference the groups they install (denormalized partNodeIds stay on
-- the step for playback simplicity; groupIds are for display/grouping)
ALTER TABLE "assemblyInstructionStep"
  ADD COLUMN "groupIds" TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE "assemblyGroup" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "assemblyInstructionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "assemblyGroupType" NOT NULL,
  "partNodeIds" TEXT[] NOT NULL DEFAULT '{}',
  -- Subassemblies link to their own child instruction
  "childInstructionId" TEXT,
  "partNumber" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyGroup_assemblyInstructionId_fkey"
    FOREIGN KEY ("assemblyInstructionId") REFERENCES "assemblyInstruction"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyGroup_childInstructionId_fkey"
    FOREIGN KEY ("childInstructionId") REFERENCES "assemblyInstruction"("id") ON DELETE SET NULL,
  CONSTRAINT "assemblyGroup_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyGroup_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyGroup_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyGroup_assemblyInstructionId_idx"
  ON "assemblyGroup" ("assemblyInstructionId");
CREATE INDEX "assemblyGroup_companyId_idx"
  ON "assemblyGroup" ("companyId");

ALTER TABLE "assemblyGroup" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyGroup"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyGroup"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyGroup"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyGroup"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );
