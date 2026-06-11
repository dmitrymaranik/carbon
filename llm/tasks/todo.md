# Assembly Editor Feature Parity — Sprint 1

Plan: `/Users/barbinbrad/.claude/plans/jaunty-launching-blanket.md` (specs: docs/specs/assembly-editor-requirements.md, docs/specs/feature-parity-plan.md)

- [x] WS0: graph foundation — packages/viewer graph.ts + describe.ts + onGraphLoaded prop + route state. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS1.1: auto-generated step titles (explorer, player overlay, placeholder, drop "Step N" seed). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS1.2: step status — migration, types.ts, validator, service, route, status dot UI. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS1.3: Details|BOM tabs in properties panel + AssemblyStepBom. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS2.1: ghost default mode (3-way future-parts toggle). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS2.2: view cube (GizmoHelper + GizmoViewcube). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS2.3: overlay step nav arrows. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS3: BOM tree (Parts tab) + highlightedNodeIds composition in viewer. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS4.1: requirements migration (assemblyInstructionStepRequirement + assemblyStandardNote). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS4.2: database types.ts + validators + service functions. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS4.3: requirement + standard-note routes + path helpers + loader. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] WS4.4: AssemblyStepRequirements UI (Tools/Notes/Std Notes/Media) + manage modal. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] Verify: viewer unit tests, per-file typechecks, MES smoke. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

Note: per AGENTS.md, never rebuild the database here — the user runs migrations.

## Sprint 2 — remaining feature parity (autonomous)

- [x] Production-module refactor (done; committed + browser-verified via /test)
- [ ] Defensive step status (DB without migration shows "undefined"). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Step search/filter in the explorer (1C.1). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Step time summary (1A.5): per-step duration display + total. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Continuous timeline (1B.4): global clock, m:ss display, step ticks. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Component grouping UI (req §4): context menu on BOM selection → cluster/kit/combination/subassembly, groups section in Parts tab, delete group. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] MES: render step requirements (notes/tools/media) in playback (req §3 display). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Authorship display (2A.3 partial): created by + last edited in header. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] NOTE: no whole-project typescript checking (user rule) — verify with vitest, biome, and browser tests only.

## Review

### Sprint 1 (4 commits on claude/confident-maxwell-dy4fvr)

- **WS0/WS1**: `packages/viewer/src/graph.ts` (indexAssemblyGraph,
  groupPartNodeIds) + `describe.ts` (describeStep) with 18 unit tests.
  AssemblyPlayer gained `onGraphLoaded`; editor derives step titles
  (verb + parts + fastener + counts) when title is null; status enum
  `assemblyStepStatus` (Todo/Review/Done) + clickable dot; right panel
  Details | BOM tabs (forceMount keeps unsaved form state).
- **WS2**: ghost default mode (original-color 30% opacity clones, lazy
  override cache, renderOrder=1), 3-way Ghost/Hidden/Solid footer control,
  drei GizmoViewcube (top-right, snaps via makeDefault OrbitControls),
  overlay < > nav buttons.
- **WS3**: AssemblyBomTree (virtualized, count/alpha sort, multi-select →
  `highlightedNodeIds` emerald highlight + camera framing + forced
  visibility, gear popover with size/volume/steps).
- **WS4**: requirement + standard-note tables/migration, service/routes,
  Requirements tab (Tools/Fixtures/Consumables with Tool catalog combobox,
  Notes with severity, Std Notes copy-insert + manage modal, Media dropzone
  to private bucket).
- Verified: viewer vitest 30/30 green, tsgo clean in apps/erp,
  packages/viewer, packages/database. apps/mes typecheck fails on a
  pre-existing missing `./+types/root` typegen artifact (fails identically
  on a clean tree). Browser verification deferred until the user rebuilds
  the database (two new migrations).
- Deferred by design: continuous timeline (§5.3), component grouping
  (kits/clusters/subassemblies), requirement drag-reorder UI (route +
  service exist; list renders in sortOrder).
