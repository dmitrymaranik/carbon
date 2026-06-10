# 3D Model / CAD Capabilities (verified 2026-06)

## Storage: `modelUpload` table

Created in `packages/database/supabase/migrations/20240630115404_model-uploads.sql`:
`id` (xid), `name`, `size`, `modelPath`, `autodeskUrn` (legacy APS translation URN),
`itemId` FK, `companyId`, audit cols. Referenced by `item`, `job`, `salesOrderLine`,
`quoteLine`, `purchaseOrderLine` etc. via `modelUploadId` columns (see many view
migrations, e.g. `20250109000722_increase-numeric-values.sql`).

Files live in Supabase storage (`private` bucket, `models/` path), served via
`apps/erp/app/routes/file+/model+/$id.tsx` and `file+/model+/public.$.tsx`.

## Viewers (packages/react)

- `packages/react/src/ModelViewer.tsx` — built on **online-3d-viewer** (`OV.EmbeddedViewer`)
  + three.js 0.163 (pinned in `packages/react/package.json`). Loads STEP/STL/etc.
  client-side via occt-import-js WASM. Computes bbox/surface area/volume, recolors
  meshes, adds lights. Limitations: no assembly tree exposure, no animation —
  occt-import-js bakes transforms into vertices.
- `packages/react/src/AutodeskViewer.tsx` (+ `autodesk.d.ts`) — Autodesk Platform
  Services (Forge) viewer: token provider context, URN-based loading. Pairs with
  `modelUpload.autodeskUrn`.

## Onshape integration (active, not removed)

`packages/ee/src/onshape/` (`client.ts`, `data.ts`) + routes
`apps/erp/app/routes/api+/integrations.onshape.*`. OAuth, documents/versions/elements,
BOM sync into Quotes/Jobs/Items (`QuoteBoMExplorer.tsx`, `JobBoMExplorer.tsx`,
`BoMExplorer.tsx`). Metadata/BOM only — no geometry export. (Earlier cache notes said
Onshape code was removed — wrong; `ONSHAPE_SECRET_KEY` in `packages/auth/src/config/env.ts`.)

## Background jobs: Inngest (NOT Trigger.dev)

`packages/jobs/src/inngest/` with `inngest` ^3.52.7 in `packages/jobs/package.json`
(also `events.ts`, `schemas.ts`, `trigger.ts` in `packages/jobs/src/`). Existing
model-related pattern: `packages/jobs/src/inngest/tasks/model-thumbnail.ts` calls a
Supabase edge function (`thumbnail`) that screenshots the viewer page and stores a PNG.
Older cache references to Trigger.dev are stale.

## MES model display

`apps/mes/app/components/JobOperation/JobOperation.tsx` renders a "Model" tab on
`/x/operation/:operationId` using ModelViewer when the job/item has a model.

## Related design work

Animated work instructions from CAD: research in
`llm/research/animated-work-instructions.md`, spec in
`docs/specs/animated-work-instructions-design.md`, plan in
`llm/tasks/animated-work-instructions-plan.md`.
