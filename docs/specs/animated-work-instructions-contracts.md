# Animated Work Instructions — Shared Contracts (Phase 0)

These contracts bind three components: the geometry service (`services/geometry`,
Python), the viewer (`packages/viewer`, TypeScript), and the ERP/Inngest layer.
Change them only by updating all three.

## 1. Stable node IDs

Every part instance in the assembly gets a stable `nodeId`:

```
nodeId = sha1(geometryHash : parentPath : siblingOrdinal)[:16]
```

- `geometryHash`: sha1 of the part's tessellated geometry (vertex positions quantized
  to 1e-3 mm, triangle indices), independent of placement.
- `parentPath`: '/'-joined product names from root to parent.
- `siblingOrdinal`: 0-based index among siblings sharing the same geometryHash and
  parent (disambiguates 4 identical brackets).

The `nodeId` appears in (a) glTF node `extras.nodeId`, (b) `graph.json` nodes,
(c) `assemblyInstructionStep.partNodeIds`.

## 2. graph.json (written by /convert)

```jsonc
{
  "version": 1,
  "unit": "mm",                  // normalized output unit (always mm in Phase 0)
  "sourceUnit": "inch",          // unit declared in the STEP file
  "partCount": 42,               // count of leaf instances
  "root": {                      // assembly tree, root has no geometry
    "nodeId": "a1b2c3d4e5f60718",
    "name": "MAIN-ASSY",
    "isAssembly": true,
    "geometryHash": null,        // null for assemblies
    "transform": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], // local, column-major 4x4
    "bbox": { "min": [0,0,0], "max": [100,50,25] },     // world-space, mm
    "volume": 1234.5,            // mm^3, leaf nodes only (null for assemblies)
    "color": [0.5, 0.5, 0.5, 1], // RGBA 0-1 or null
    "children": [ /* same shape */ ]
  }
}
```

## 3. Geometry service API

Auth: `Authorization: Bearer <GEOMETRY_SERVICE_API_KEY>` (shared secret env var on
both sides).

### POST /convert
```jsonc
// request
{
  "jobId": "string",                  // assemblyPlanJob.id, used in logs
  "source": { "url": "https://signed-get-url", "format": "step" },
  "outputs": {
    "glb":   { "url": "https://signed-put-url" },
    "graph": { "url": "https://signed-put-url" }
  },
  "options": { "linearDeflection": 0.1, "angularDeflection": 0.5 } // optional
}
// response 200 (synchronous in Phase 0; Inngest applies its own timeout/retries)
{ "ok": true, "partCount": 42, "unit": "mm", "stats": { "convertMs": 1234, "meshTriangles": 100000 } }
// response 4xx/5xx
{ "ok": false, "error": "human-readable message", "code": "READ_FAILED" | "TESSELLATION_FAILED" | "UPLOAD_FAILED" | "INVALID_INPUT" | "LIMIT_EXCEEDED" | "BUSY" }
// status mapping: 400 INVALID_INPUT (incl. URL policy violations), 413
// LIMIT_EXCEEDED (source size / part count), 422 READ_FAILED, 429 BUSY (no
// conversion slot free — caller should retry with backoff), 500
// TESSELLATION_FAILED, 502 UPLOAD_FAILED.
```

### GET /health → `{ "ok": true, "version": "x.y.z" }`

### Operational limits (service env vars)

- `GEOMETRY_MAX_SOURCE_MB` (default 250) — source download cap
- `GEOMETRY_MAX_PARTS` (default 5000) — leaf instances, checked before meshing
- `GEOMETRY_MAX_CONCURRENCY` (default 2) — conversion slots per worker; excess → 429 BUSY
- `GEOMETRY_ALLOWED_URL_HOSTS` (optional, comma-separated) — allowlist for
  source/output URL hosts (set to the Supabase storage host in production)
- `GEOMETRY_DEV_MODE=true` — permits http URLs and unauthenticated access when
  no API key is set (local dev only)

## 4. Step motion JSON (`assemblyInstructionStep.motion`)

Describes the **insertion** motion of the step's parts into the assembly. The viewer
derives removal (the reverse) and start poses from it. Distances in mm, in the same
world space as the GLB.

```jsonc
// linear insertion along a vector
{ "type": "linear", "direction": [0, 0, -1], "distance": 80 }

// two-segment: travel1 then travel2 (insertion order), e.g. slide then drop
{ "type": "L",
  "segments": [
    { "direction": [1, 0, 0], "distance": 60 },
    { "direction": [0, 0, -1], "distance": 20 }
  ] }

// threaded fastener: helix about axis, then it is seated
{ "type": "helix", "axis": [0, 0, -1], "origin": [10, 20, 5],
  "pitch": 0.8, "turns": 6, "approach": 30 } // approach = linear travel before threading

// explicit keyframe path (planner tier 5 / manual freeform)
{ "type": "path", "keyframes": [
    { "t": 0,   "position": [0,0,100], "quaternion": [0,0,0,1] },
    { "t": 1,   "position": [0,0,0],   "quaternion": [0,0,0,1] }
  ] }

// no geometry motion (process-only step: cure, inspect, torque pattern)
{ "type": "none" }
```

`camera` JSON: `{ "position": [x,y,z], "target": [x,y,z], "fov": 45 }` or `null`
(viewer auto-frames the active parts).

`fastener` JSON: `{ "spec": "M5 SHCS", "count": 4, "torqueNm": 8, "tool": "4mm hex" }`
(all fields optional).

## 5. Viewer step shape (props of AssemblyPlayer)

```ts
type AssemblyStep = {
  id: string;
  title: string | null;
  instructionText: string | null;
  partNodeIds: string[];     // parts installed in this step
  motion: Motion;            // section 4
  camera: CameraPose | null;
  fastener: Fastener | null;
};
```

Playback semantics for step k (0-based): parts of steps < k are shown solid in final
pose; parts of step k animate per `motion` (looping); parts of steps > k are hidden
(or ghosted when the "x-ray" toggle is on). Parts in no step are always shown solid
(base/fixture parts).
