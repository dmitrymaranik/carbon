-- Assembly editor parity: step status/grouping, per-step requirements,
-- standard note templates, and part grouping (clusters/kits/subassemblies).

-- 1. Step review status + group references
ALTER TABLE "assemblyInstructionStep" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'todo'
  CHECK ("status" IN ('todo', 'review', 'done'));
ALTER TABLE "assemblyInstructionStep" ADD COLUMN "groupIds" TEXT[] NOT NULL DEFAULT '{}';

-- 2. Part groups: clusters (visual), kits (picked together), combinations
--    (treated as one part), subassemblies (own child instruction)
CREATE TABLE "assemblyGroup" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "assemblyInstructionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('cluster', 'kit', 'combination', 'subassembly')),
  "partNodeIds" TEXT[] NOT NULL DEFAULT '{}',
  "childInstructionId" TEXT,
  "partNumber" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyGroup_assemblyInstructionId_fkey" FOREIGN KEY ("assemblyInstructionId") REFERENCES "assemblyInstruction"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyGroup_childInstructionId_fkey" FOREIGN KEY ("childInstructionId") REFERENCES "assemblyInstruction"("id") ON DELETE SET NULL,
  CONSTRAINT "assemblyGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyGroup_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyGroup_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyGroup_assemblyInstructionId_idx" ON "assemblyGroup"("assemblyInstructionId");
CREATE INDEX "assemblyGroup_companyId_idx" ON "assemblyGroup"("companyId");

-- 3. Per-step requirements: tools, fixtures, consumables, notes, media
CREATE TABLE "assemblyInstructionStepRequirement" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "assemblyInstructionStepId" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('tool', 'fixture', 'consumable', 'note', 'media')),
  "itemId" TEXT,
  "text" TEXT,
  "filePath" TEXT,
  "severity" TEXT CHECK ("severity" IN ('info', 'caution', 'warning')),
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyInstructionStepRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyInstructionStepRequirement_stepId_fkey" FOREIGN KEY ("assemblyInstructionStepId") REFERENCES "assemblyInstructionStep"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyInstructionStepRequirement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL,
  CONSTRAINT "assemblyInstructionStepRequirement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepRequirement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyInstructionStepRequirement_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyInstructionStepRequirement_stepId_idx" ON "assemblyInstructionStepRequirement"("assemblyInstructionStepId");
CREATE INDEX "assemblyInstructionStepRequirement_companyId_idx" ON "assemblyInstructionStepRequirement"("companyId");

-- 4. Company-level reusable note templates
CREATE TABLE "assemblyStandardNote" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info' CHECK ("severity" IN ('info', 'caution', 'warning')),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyStandardNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyStandardNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyStandardNote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyStandardNote_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyStandardNote_companyId_idx" ON "assemblyStandardNote"("companyId");

-- 5. RLS
ALTER TABLE "assemblyGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyInstructionStepRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assemblyStandardNote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyGroup"
  FOR SELECT USING (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_view')::text[])
  );
CREATE POLICY "INSERT" ON "assemblyGroup"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_create')::text[])
  );
CREATE POLICY "UPDATE" ON "assemblyGroup"
  FOR UPDATE USING (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_update')::text[])
  );
CREATE POLICY "DELETE" ON "assemblyGroup"
  FOR DELETE USING (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_delete')::text[])
  );

CREATE POLICY "SELECT" ON "assemblyInstructionStepRequirement"
  FOR SELECT USING (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_view')::text[])
  );
CREATE POLICY "INSERT" ON "assemblyInstructionStepRequirement"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_create')::text[])
  );
CREATE POLICY "UPDATE" ON "assemblyInstructionStepRequirement"
  FOR UPDATE USING (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_update')::text[])
  );
CREATE POLICY "DELETE" ON "assemblyInstructionStepRequirement"
  FOR DELETE USING (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_delete')::text[])
  );

CREATE POLICY "SELECT" ON "assemblyStandardNote"
  FOR SELECT USING (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_view')::text[])
  );
CREATE POLICY "INSERT" ON "assemblyStandardNote"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_create')::text[])
  );
CREATE POLICY "UPDATE" ON "assemblyStandardNote"
  FOR UPDATE USING (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_update')::text[])
  );
CREATE POLICY "DELETE" ON "assemblyStandardNote"
  FOR DELETE USING (
    "companyId" = ANY (get_companies_with_employee_permission('assembly_delete')::text[])
  );
