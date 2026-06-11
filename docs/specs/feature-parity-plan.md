# Feature Parity Plan: Assembly Instructions Editor

Based on detailed analysis of the competitor screenshot (V8 engine turbo assembly,
~50 steps, ~600-part assembly) compared to our current Phase 0 editor.

## Gap Analysis

### What we have (Phase 0)
- 3D viewer with orbit controls, per-part colors, lighting
- Left pane: flat step list with "Add Step", drag-reorder
- Center: AssemblyPlayer with play/pause, prev/next, step scrubber
- Right pane: step properties form (title, text, motion, fastener, duration)
- Header: instruction name, DRAFT badge, Publish button, item link
- Database: steps with partNodeIds, motion JSON, camera, fastener, warnings

### What the competitor has that we don't

#### 1. Step List (Left Panel) — HIGH PRIORITY
**Current:** Flat list, plain titles, no status indicators, no part/quantity info.
**Target:**
- **Auto-generated step descriptions** from parts: "Add Engine V8-XT-29:8 (x8)"
  showing part names, fastener specs (DIN 912, M18×130), and quantities in parens.
  Steps use verb classification: "Add" (insert part), "Assemble" (multi-part
  operation). Our `partNodeIds` + `fastener` JSON has the data; we just don't
  render it as a summary.
- **Status indicators per step**: red/yellow/green circles. Maps to our
  `planConfidence` + a new `validated` boolean — red = has warnings or low
  confidence, yellow = manual/unreviewed, green = validated by the author.
- **Multi-part steps**: a single step lists the main part(s) + their fasteners
  as one operation (e.g., "Add Engine V8-XT-45:1, DIN 3760 - AS-85×110×12-NBR:1,
  Engine V8-XT-0..."). We already support `partNodeIds: string[]` — the display
  just needs to join part names from the graph.
- **Component tree toolbar**: undo, settings, tree/list toggle, search/filter.
  We have no undo, no search within steps.

#### 2. Step BOM & Requirements (Right Panel) — HIGH PRIORITY
**Current:** Step form with title, text, motion fields, fastener spec.
**Target:** Tabbed requirements panel with:
- **Step BOM**: parts used in this step with quantities (derived from
  `partNodeIds` + graph.json names; group identical parts and count). The
  screenshot shows "DIN 6912 - M12×30:2 — 13" with a warning icon.
- **Tools**: tool references per step (link to Carbon's existing resource/tool
  catalog — `methodOperationTool` pattern). Empty state: "No tools to display."
- **Fixtures**: fixture references per step.
- **Consumables**: adhesives, lubricants, sealants per step.
- **Notes**: free-text notes per step (we have `notes` JSON field already).
- **Standard Notes**: reusable note templates (e.g., "Apply Loctite 242").
- **Media**: image/video attachments per step (photos of the real assembly,
  reference images).
- **Step Time Summary**: estimated time for this step (we have
  `durationSeconds` — just need a display).

#### 3. 3D Viewer Enhancements — MEDIUM PRIORITY
**Current:** Basic orbit + play/pause/scrub.
**Target:**
- **View cube** (top-right): shows Front/Right/Top orientation, clickable to
  snap to standard views. drei's `GizmoHelper` + `GizmoViewcube`.
- **Part transparency**: non-active parts rendered semi-transparent (gold/ghost),
  active step's parts fully opaque + highlighted color. We have ghost/wireframe
  via x-ray toggle; need a "context transparency" mode that's on by default.
- **Custom viewpoints dropdown**: save named camera poses per instruction,
  recall from a dropdown. Maps to the `settings.viewpoints` JSON.
- **Annotation/markup tool**: draw on the 3D view (arrow, circle, text).
  Phase 3+ feature — complex, defer.
- **Step navigation arrows** overlaid on the viewer (large < > buttons on
  left/right edges). We have prev/next in the footer; adding overlay arrows
  is trivial CSS.
- **Video timeline**: "0:00 / 0:20" — the full instruction rendered as a
  timed animation. We generate per-step clips; stitching them into a
  continuous timeline with a progress display is the gap.

#### 4. Model vs. Instructions Tabs — LOW PRIORITY
**Current:** Single editor view.
**Target:** Two top-level tabs:
- "Model" — the raw assembly viewer (explore parts, no step context).
- "Instructions" — the current editor view with step playback.
Carbon already has a Model tab on the item details page; adding a tab
switcher to the instruction editor is small.

#### 5. Sharing & Collaboration — MEDIUM PRIORITY
**Current:** Publish button changes status; no share mechanism.
**Target:**
- **Share button** generating a public/authenticated viewer link (our
  `share+` route is designed but not built).
- **Authorship display**: "By you" / "By [name]" + last-edited timestamp.
  We have `createdBy`/`updatedAt`; just need a display.
- **Version tracking**: "Edit 1" badge. We have `version INT` on
  `assemblyInstruction`; need a version-bump flow on publish and a display.

#### 6. Export — LOW PRIORITY
**Current:** None.
**Target:** Export toolbar button with PDF/Word/PowerPoint/interactive-web
options. Interactive-web = the `share+` link. PDF = per-step rendered frames
via the existing `packages/documents` pipeline (Phase 3 in the original plan).

---

## Implementation Plan

### Phase 1A: Step List & Step BOM (the "looks like a real product" phase)

**Why first:** the screenshot's most visible difference is the step list
showing rich part-aware descriptions and the Step BOM panel. These are
data-display features — the data already exists in our `partNodeIds` +
`graph.json`; we just don't surface it.

#### 1A.1 Step description auto-generation
- When `partNodeIds` is set and `title` is empty, derive a display title:
  join part names from graph.json, classify verb ("Add" for single-part
  insertion, "Assemble" for multi-part), append fastener spec + quantities.
  Format: `"Add Seat Rail Clamp:1, M5 SHCS (×4)"`.
- Pure client-side derivation in the explorer component (read graph from
  `useAssembly` context, look up nodeIds → names).
- Quantities: count duplicate geometryHashes within the step's partNodeIds.

#### 1A.2 Step status indicators
- Add `status` field to `assemblyInstructionStep`: `'todo' | 'review' |
  'done'` (default 'todo'). Render as red/yellow/green dot in the step list.
- "Done" = author clicked a checkmark or explicitly marked validated.
- "Review" = planner-generated steps (planConfidence != 'manual') that
  haven't been reviewed.
- "Todo" = newly added manual steps with no content.

#### 1A.3 Step BOM panel
- Right panel gets tabs: "Details" (current form) | "BOM" | "Requirements".
- BOM tab: list of parts in the step, grouped by geometry hash (identical
  parts), showing part name + quantity + a small thumbnail (rendered inline
  from the graph bbox or a colored dot matching the part's color).
- Derived from `partNodeIds` + graph.json — no new database fields.

#### 1A.4 Requirements tabs (Tools / Fixtures / Consumables / Notes / Media)
- **Schema:** new `assemblyInstructionStepRequirement` table:
  `(id, stepId, type ['tool'|'fixture'|'consumable'|'note'|'media'],
  resourceId? FK, text?, filePath?, sortOrder, companyId, audit)`.
  Links to existing Carbon resource catalog where applicable.
- **UI:** collapsible sections in the right panel (mirror the screenshot's
  layout exactly). Each section: list of items + "Add" button. Tool/fixture
  sections search the existing resources module; consumable/note are
  free-text; media uploads to storage.
- **Standard Notes:** reusable templates stored at the instruction level
  (or company level) — `assemblyStandardNote` table, selectable in the
  notes section.

#### 1A.5 Step Time Summary
- Display `durationSeconds` as "Est. X min Y sec" in the right panel footer.
- Sum all step durations in the header or a summary view.

---

### Phase 1B: Viewer Polish

#### 1B.1 View cube
- Add drei `GizmoHelper` + `GizmoViewcube` to AssemblyViewer. Matches the
  screenshot's top-right orientation cube showing Front/Right/Top.

#### 1B.2 Context transparency (default ghost mode)
- Non-active parts render at 30% opacity with their original color (not
  wireframe). Active step's parts are fully opaque with a subtle emissive
  highlight. This replaces the current binary hide/wireframe x-ray toggle
  as the default rendering mode.
- Add a "Solid / Ghost / Hidden" toggle for future parts (the x-ray button
  becomes a 3-way toggle).

#### 1B.3 Overlay step navigation
- Large translucent < > arrow buttons on left/right edges of the viewer
  (absolutely positioned over the canvas), matching the screenshot.
- Keep the footer scrubber too.

#### 1B.4 Continuous timeline
- Stitch per-step clips into one continuous AnimationAction sequence.
- Display total duration as "0:00 / 1:23" in the footer.
- Scrubber maps to the global timeline position, not just step index.

---

### Phase 1C: Step List Toolbar & Search

#### 1C.1 Step search/filter
- Search input above the step list filtering by part name, step title,
  fastener spec. Client-side filter over the loaded steps.

#### 1C.2 Undo/redo
- Step reorder, add, delete, and property edits pushed to an undo stack.
  Client-side state with undo/redo buttons in the step list toolbar.

#### 1C.3 Tree vs. flat toggle
- When steps have `parentStepId` (subassembly grouping), toggle between
  tree view (indented children) and flat view (all steps sequential).

---

### Phase 2A: Model/Instructions Tabs & Collaboration

#### 2A.1 Model tab in editor
- Add "Model" / "Instructions" tab bar at the top of the editor.
- Model tab: full assembly viewer with part tree sidebar (from graph.json),
  click-to-inspect (shows part name, volume, bbox, color). No step context.
- Instructions tab: current editor.

#### 2A.2 Sharing
- Build the `share+` route: read-only AssemblyPlayer rendered at a signed,
  revocable URL. No auth required. Generate from a "Share" button in the
  editor header.
- Show "Shared with link" badge when active; revoke button.

#### 2A.3 Authorship & versions
- Display "By [createdBy name]" + "Edited [updatedAt relative]" in the header.
- Version bump on Publish (increment `version`, snapshot the step set).
- Version history dropdown showing past versions (read-only).

---

### Phase 2B: Export

#### 2B.1 Interactive web export
- The `share+` link IS the interactive web export.

#### 2B.2 PDF export
- Per-step pages: rendered 3D frame (offscreen canvas → PNG) + step title +
  instruction text + BOM + requirements. Use `packages/documents` React PDF
  pipeline.

---

### Phase 3: Auto-Draft Planner (from original plan)

All of the above is manual authoring UX. The planner (fastener detection,
greedy disassembly, auto-sequencing, auto-text) layers on top — it produces
a draft that populates these same fields. The richer the editor, the more
useful the planner output becomes.

---

## Priority Order (what to build next)

| # | Feature | Impact | Effort | Phase |
|---|---------|--------|--------|-------|
| 1 | Step description auto-gen from parts | High — makes steps readable | Small | 1A.1 |
| 2 | Step BOM panel | High — core workflow | Medium | 1A.3 |
| 3 | Step status indicators | Medium — visual polish | Small | 1A.2 |
| 4 | Context transparency (ghost mode) | High — visual quality | Small | 1B.2 |
| 5 | View cube | Medium — orientation UX | Small | 1B.1 |
| 6 | Overlay step nav arrows | Medium — usability | Trivial | 1B.3 |
| 7 | Requirements tabs (tools/notes/media) | High — process data | Medium | 1A.4 |
| 8 | Step search/filter | Medium — scale UX | Small | 1C.1 |
| 9 | Continuous timeline | Medium — polish | Medium | 1B.4 |
| 10 | Step time summary | Low — display only | Trivial | 1A.5 |
| 11 | Model/Instructions tabs | Low — navigation | Small | 2A.1 |
| 12 | Share link | Medium — distribution | Medium | 2A.2 |
| 13 | Authorship + versions | Low — collaboration | Small | 2A.3 |
| 14 | PDF export | Medium — offline use | Medium | 2B.2 |
| 15 | Undo/redo | Medium — editing UX | Medium | 1C.2 |
| 16 | Tree vs flat toggle | Low — scale UX | Small | 1C.3 |
| 17 | Annotations/markup | Low — advanced | Large | Defer |

**Recommended next sprint:** items 1–6 (one focused push to make the editor
look and feel like a real assembly instruction tool). Items 1–3 are left-panel
changes, 4–6 are viewer changes — parallelizable.
