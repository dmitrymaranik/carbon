-- Assembly module: automated/animated 3D work instructions from CAD models.
-- Foundations: Assembly permission module, model processing columns, plan job table.

-- 1. Add the Assembly module
ALTER TYPE module ADD VALUE 'Assembly';

COMMIT;

DROP VIEW IF EXISTS "modules";
CREATE VIEW "modules" AS
    SELECT unnest(enum_range(NULL::module)) AS name;

-- Seed Assembly module permissions for Admin, Management, and Engineering employee types
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT
    et.id AS "employeeTypeId",
    'Assembly'::module AS "module",
    ARRAY[et."companyId"] AS "create",
    ARRAY[et."companyId"] AS "delete",
    ARRAY[et."companyId"] AS "update",
    ARRAY[et."companyId"] AS "view"
FROM "employeeType" et
WHERE et.name IN ('Admin', 'Management', 'Engineering')
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Grant assembly permissions to users based on their existing parts permissions
UPDATE "userPermission"
SET "permissions" = "permissions" || jsonb_build_object(
  'assembly_view', COALESCE("permissions"->'parts_view', '[]'::jsonb),
  'assembly_create', COALESCE("permissions"->'parts_create', '[]'::jsonb),
  'assembly_update', COALESCE("permissions"->'parts_update', '[]'::jsonb),
  'assembly_delete', COALESCE("permissions"->'parts_delete', '[]'::jsonb)
);

-- 2. Server-side model processing state on modelUpload
CREATE TYPE "modelProcessingStatus" AS ENUM (
  'Idle',
  'Queued',
  'Processing',
  'Success',
  'Failed'
);

ALTER TABLE "modelUpload" ADD COLUMN "processingStatus" "modelProcessingStatus" NOT NULL DEFAULT 'Idle';
ALTER TABLE "modelUpload" ADD COLUMN "processingError" TEXT;
ALTER TABLE "modelUpload" ADD COLUMN "glbPath" TEXT;
ALTER TABLE "modelUpload" ADD COLUMN "graphPath" TEXT;
ALTER TABLE "modelUpload" ADD COLUMN "partCount" INTEGER;
ALTER TABLE "modelUpload" ADD COLUMN "processedAt" TIMESTAMP WITH TIME ZONE;

-- 3. Geometry pipeline runs (conversion now, sequence planning later)
CREATE TABLE "assemblyPlanJob" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "modelUploadId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('convert', 'plan')),
  "status" "modelProcessingStatus" NOT NULL DEFAULT 'Queued',
  "planPath" TEXT,
  "stats" JSONB,
  "error" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyPlanJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyPlanJob_modelUploadId_fkey" FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyPlanJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyPlanJob_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyPlanJob_modelUploadId_idx" ON "assemblyPlanJob"("modelUploadId");
CREATE INDEX "assemblyPlanJob_companyId_idx" ON "assemblyPlanJob"("companyId");

ALTER TABLE "assemblyPlanJob" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyPlanJob"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('assembly_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyPlanJob"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('assembly_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyPlanJob"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('assembly_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyPlanJob"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('assembly_delete')::text[]
    )
  );
