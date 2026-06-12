-- Maps distinct model parts (graph.json geometry hashes) to items from the
-- engineering bill of materials (methodMaterial). Keyed by modelUpload so a
-- mapping is authored once per model and shared by every instruction using
-- it; geometryHash identifies a distinct part across all of its instances
-- (with a "name:<name>" fallback key for parts without a hash).

CREATE TABLE "assemblyPartMapping" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "modelUploadId" TEXT NOT NULL,
  "geometryHash" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  -- 'high' = exact/strong name match or human-confirmed, 'low' = heuristic
  "confidence" TEXT NOT NULL DEFAULT 'high' CHECK ("confidence" IN ('high', 'low')),
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyPartMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyPartMapping_modelUploadId_geometryHash_key"
    UNIQUE ("modelUploadId", "geometryHash"),
  CONSTRAINT "assemblyPartMapping_modelUploadId_fkey"
    FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyPartMapping_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyPartMapping_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyPartMapping_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyPartMapping_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyPartMapping_modelUploadId_idx"
  ON "assemblyPartMapping" ("modelUploadId");
CREATE INDEX "assemblyPartMapping_itemId_idx"
  ON "assemblyPartMapping" ("itemId");
CREATE INDEX "assemblyPartMapping_companyId_idx"
  ON "assemblyPartMapping" ("companyId");

ALTER TABLE "assemblyPartMapping" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyPartMapping"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyPartMapping"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyPartMapping"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyPartMapping"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );
