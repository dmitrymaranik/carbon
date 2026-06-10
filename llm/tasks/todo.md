# Animated Work Instructions — Phase 0 Implementation

Plan: `llm/tasks/animated-work-instructions-plan.md`

- [x] 0.1 Geometry service skeleton (services/geometry). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 0.2 STEP → GLB + graph.json conversion. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 0.3 Meshopt compression pass. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 0.4 Migration: modelUpload processing columns + assemblyPlanJob. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 0.5 Inngest convert pipeline. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 0.6 packages/viewer: AssemblyPlayer. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 0.7 Migration: assemblyInstruction tables + permissions. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 0.8 Assembly module: models + service. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 0.9 ERP routes: instruction editor (manual authoring MVP). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 0.10 MES playback (read-only). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] 0.11 Phase 0 verification (typecheck/lint/tests; browser verify deferred until user rebuilds db). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

Note: per AGENTS.md, never rebuild the database here — db:build verification waits for the user.

## Review

### 0.9 + 0.10 (ERP routes + MES playback)

- ERP: new `x+/assembly+` route folder (list, new modal, three-pane editor,
  status/delete/step actions) mirroring `x+/procedure+`; UI in
  `modules/assembly/ui/Assembly/`. Step order route uses Kysely
  `getDatabaseClient()` (sales-order line-order pattern).
- `assemblyInstructionStepValidator.partNodeIds` now accepts JSON strings via
  `jsonField` so the editor can submit (and clear) selections as one hidden
  field.
- Nav: `assembly` module added to `useModules` (permission-gated). Part
  details Model section gets a "Create Assembly Instruction" button when the
  item's modelUpload `processingStatus === 'Success'`.
- MES: `getJobOperationAssembly` service + loader wiring; new "Assembly" tab
  with read-only AssemblyPlayer and large prev/next buttons.
- Verified: `pnpm typecheck` clean in apps/mes; apps/erp clean except a
  pre-existing error in `packages/jobs/.../assembly-convert.ts` (committed
  code, out of scope). Biome clean on all changed files.
- Before commit: run root `pnpm lingui:check` (new msg`Assembly` etc. are not
  yet in catalogs). Phase 0 rough edges: `path` motions render but are not
  editable (switching motion type overwrites them on save); clearing
  `durationSeconds` does not persist (service skips undefined).
