"""Assembly-by-disassembly motion planner.

Computes a collision-free removal motion for every leaf part plus a greedy
assembly sequence (see docs/specs/animated-work-instructions-contracts.md,
POST /plan). The same STEP source is re-tessellated with the same nodeId
derivation as /convert, so plan.json keys join against graph.json and the
GLB extras.

Algorithm (per llm/research/animated-work-instructions.md):
- Tier 1: greedy disassembly testing straight-line candidate directions
  (world axes + the part's principal axis). A part is removable when the
  densely sampled removal path is collision-free against the remaining
  parts (small penetration tolerance allows sliding fits).
- Tier 2: two-segment "L" motions (lift then slide) for tier-1 failures.
- Leftovers get motion "none" with the blocking parts recorded; the human
  editor resolves them.

The recorded motion is the INSERTION motion (removal reversed), matching
the viewer contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.convert import (
    AssemblyNode,
    _assign_node_ids,
    _build_tree,
    _compute_world_bboxes,
    _read_step,
)
from app.errors import ConvertError

PLAN_VERSION = 1
OUTPUT_UNIT = "mm"

# Allowed surface penetration (mm) along a removal path. Parts in contact at
# the seated pose report hairline collisions; sliding fits (pin in bore)
# stay in surface contact for most of their travel.
PENETRATION_TOLERANCE_MM = 0.15

# Margin (mm) past the assembly bounds before a part counts as "out".
EXIT_MARGIN_MM = 5.0

WORLD_AXES = [
    np.array([0.0, 0.0, 1.0]),
    np.array([0.0, 0.0, -1.0]),
    np.array([1.0, 0.0, 0.0]),
    np.array([-1.0, 0.0, 0.0]),
    np.array([0.0, 1.0, 0.0]),
    np.array([0.0, -1.0, 0.0]),
]


@dataclass
class _Part:
    node_id: str
    name: str
    mesh: "object"  # trimesh.Trimesh, world space
    bbox_min: np.ndarray
    bbox_max: np.ndarray
    is_proxy: bool


@dataclass
class PlannedPart:
    node_id: str
    motion: dict
    confidence: str | None  # "high" | "low" | None for unplanned
    removal_direction: list[float] | None
    blocked_by: list[str] = field(default_factory=list)


@dataclass
class PlanResult:
    plan: dict
    part_count: int
    planned_count: int
    tiers: dict
    warnings: list[str]


def plan_step(
    step_path: Path,
    linear_deflection: float = 0.1,
    angular_deflection: float = 0.5,
    clearance: float = 0.5,
    path_samples: int = 60,
    max_parts: int | None = None,
) -> PlanResult:
    """Plan removal motions and an assembly sequence for a STEP file."""
    try:
        import trimesh
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise ConvertError(
            "TESSELLATION_FAILED", f"collision libraries unavailable: {exc}"
        ) from exc

    warnings: list[str] = []
    doc = _read_step(step_path)
    root = _build_tree(doc, linear_deflection, angular_deflection, warnings)
    _assign_node_ids(root)
    _compute_world_bboxes(root, np.eye(4))

    parts = _collect_world_parts(root, trimesh)
    if max_parts is not None and len(parts) > max_parts:
        raise ConvertError(
            "LIMIT_EXCEEDED",
            f"assembly has {len(parts)} part instances; the limit is {max_parts}",
            413,
        )
    if any(part.is_proxy for part in parts):
        warnings.append(
            "some parts use bounding-box proxy meshes; their motions are low confidence"
        )

    planned, sequence, tiers = _greedy_disassembly(
        parts, trimesh, clearance=clearance, path_samples=path_samples
    )

    plan = {
        "version": PLAN_VERSION,
        "unit": OUTPUT_UNIT,
        "sequence": sequence,
        "parts": {
            entry.node_id: _part_to_dict(entry) for entry in planned
        },
        "warnings": warnings,
    }
    planned_count = sum(
        1 for entry in planned if entry.motion.get("type") != "none"
    )
    return PlanResult(
        plan=plan,
        part_count=len(parts),
        planned_count=planned_count,
        tiers=tiers,
        warnings=warnings,
    )


def _part_to_dict(entry: PlannedPart) -> dict:
    payload: dict = {"motion": entry.motion}
    if entry.confidence is not None:
        payload["confidence"] = entry.confidence
    if entry.removal_direction is not None:
        payload["removalDirection"] = entry.removal_direction
    if entry.blocked_by:
        payload["blockedBy"] = entry.blocked_by
    return payload


def _collect_world_parts(root: AssemblyNode, trimesh_mod) -> list[_Part]:
    parts: list[_Part] = []

    def visit(node: AssemblyNode, parent_world: np.ndarray) -> None:
        local = np.asarray(node.transform, dtype=np.float64).reshape(4, 4).T
        world = parent_world @ local
        if node.mesh is not None and len(node.mesh.positions) > 0:
            positions = node.mesh.positions.astype(np.float64)
            transformed = positions @ world[:3, :3].T + world[:3, 3]
            mesh = trimesh_mod.Trimesh(
                vertices=transformed,
                faces=node.mesh.indices.astype(np.int64),
                process=False,
            )
            parts.append(
                _Part(
                    node_id=node.node_id,
                    name=node.name,
                    mesh=mesh,
                    bbox_min=transformed.min(axis=0),
                    bbox_max=transformed.max(axis=0),
                    is_proxy=node.mesh.is_proxy,
                )
            )
        for child in node.children:
            visit(child, world)

    visit(root, np.eye(4))
    return parts


def _symmetry_axis(part: _Part) -> np.ndarray | None:
    """The natural insertion axis of a fastener-like part.

    Rod-like parts (bolts, pins, screws: one dominant extent) insert along
    their long axis; disc-like parts (washers, nuts: two equal dominant
    extents) insert along their normal. Returns None for parts without a
    clear axis.
    """
    vertices = np.asarray(part.mesh.vertices)
    if len(vertices) < 3:
        return None
    centered = vertices - vertices.mean(axis=0)
    try:
        singular, basis = np.linalg.svd(centered, full_matrices=False)[1:]
    except np.linalg.LinAlgError:  # pragma: no cover - degenerate mesh
        return None
    s1, s2, s3 = (float(s) for s in singular[:3])
    if s2 <= 1e-9:
        return None
    if s1 > 1.4 * s2:
        axis = basis[0]  # rod: dominant extent is the axis
    elif s3 > 1e-9 and s2 > 1.4 * s3 and s1 < 1.25 * s2:
        axis = basis[2]  # disc: the normal is the smallest extent
    else:
        return None
    norm = np.linalg.norm(axis)
    if norm <= 1e-9:
        return None
    axis = axis / norm
    # Snap near-axis-aligned directions to clean world axes (stable plan
    # output, and identical fasteners group on exact direction matches)
    for world in WORLD_AXES:
        if float(np.dot(axis, world)) > 0.999:
            return world.copy()
    return axis


def _candidate_directions(part: _Part) -> list[np.ndarray]:
    """Removal directions to try, most natural first.

    A part's own symmetry axis comes before the world axes so fasteners
    leave through their own bores instead of the first free world
    direction.
    """
    candidates: list[np.ndarray] = []
    axis = _symmetry_axis(part)
    if axis is not None:
        candidates.extend([axis, -axis])

    for world in WORLD_AXES:
        if all(abs(float(np.dot(world, c))) < 0.99 for c in candidates):
            candidates.append(world)
    return candidates


def _greedy_disassembly(
    parts: list[_Part],
    trimesh_mod,
    clearance: float,
    path_samples: int,
) -> tuple[list[PlannedPart], list[str], dict]:
    from trimesh.collision import CollisionManager

    by_id = {part.node_id: part for part in parts}
    remaining: dict[str, _Part] = dict(by_id)

    manager = CollisionManager()
    for part in parts:
        manager.add_object(part.node_id, part.mesh)

    removal_order: list[PlannedPart] = []
    tiers = {"linear": 0, "l": 0, "unplanned": 0}

    progressed = True
    while remaining and progressed:
        progressed = False
        # Outer parts first: removing top-most parts first reads naturally
        scan = sorted(
            remaining.values(), key=lambda p: float(p.bbox_max[2]), reverse=True
        )
        for part in scan:
            if len(remaining) == 1:
                # The last part is the base: it "assembles" by being placed
                remaining.pop(part.node_id)
                removal_order.append(
                    PlannedPart(
                        node_id=part.node_id,
                        motion={"type": "none"},
                        confidence="high",
                        removal_direction=None,
                    )
                )
                progressed = True
                break

            manager.remove_object(part.node_id)
            planned = None
            try:
                planned = _plan_removal(
                    part, remaining, manager, clearance, path_samples
                )
            finally:
                if planned is None:
                    manager.add_object(part.node_id, part.mesh)

            if planned is not None:
                tiers["linear" if planned.confidence == "high" else "l"] += 1
                removal_order.append(planned)
                remaining.pop(part.node_id)
                progressed = True

    # Leftovers are interlocked (or need motions the planner does not search)
    leftovers: list[PlannedPart] = []
    for part in remaining.values():
        blocked_by = _blockers(part, remaining, trimesh_mod)
        leftovers.append(
            PlannedPart(
                node_id=part.node_id,
                motion={"type": "none"},
                confidence=None,
                removal_direction=None,
                blocked_by=blocked_by,
            )
        )
        tiers["unplanned"] += 1

    # Assembly order = leftovers (base/interlocked) first, then the greedy
    # removal order reversed
    sequence = [entry.node_id for entry in leftovers] + [
        entry.node_id for entry in reversed(removal_order)
    ]
    planned_parts = leftovers + removal_order
    return planned_parts, sequence, tiers


def _plan_removal(
    part: _Part,
    remaining: dict[str, _Part],
    manager,
    clearance: float,
    path_samples: int,
) -> PlannedPart | None:
    others = [p for p in remaining.values() if p.node_id != part.node_id]
    if not others:
        return None

    static_min = np.min([p.bbox_min for p in others], axis=0)
    static_max = np.max([p.bbox_max for p in others], axis=0)

    # Tier 1: straight line
    for direction in _candidate_directions(part):
        travel = _exit_travel(part, static_min, static_max, direction)
        if travel <= 0:
            continue
        if _path_is_clear(part, manager, direction, 0.0, travel, path_samples):
            confidence = "low" if part.is_proxy else "high"
            return PlannedPart(
                node_id=part.node_id,
                motion={
                    "type": "linear",
                    "direction": [-float(c) for c in direction],
                    "distance": round(float(travel), 3),
                },
                confidence=confidence,
                removal_direction=[float(c) for c in direction],
            )

    # Tier 2: lift then slide ("L"). First segment is a short escape hop,
    # the second exits the assembly.
    part_size = part.bbox_max - part.bbox_min
    hop = float(np.linalg.norm(part_size)) or 1.0
    samples_segment = max(12, path_samples // 3)
    for first in WORLD_AXES:
        if not _path_is_clear(part, manager, first, 0.0, hop, samples_segment):
            continue
        offset = first * hop
        for second in WORLD_AXES:
            if abs(float(np.dot(first, second))) > 0.99:
                continue
            travel = _exit_travel(part, static_min, static_max, second, offset)
            if travel <= 0:
                continue
            if _path_is_clear(
                part,
                manager,
                second,
                0.0,
                travel,
                samples_segment,
                base_offset=offset,
            ):
                # Insertion motion reverses the removal: slide in, then drop
                return PlannedPart(
                    node_id=part.node_id,
                    motion={
                        "type": "L",
                        "segments": [
                            {
                                "direction": [-float(c) for c in second],
                                "distance": round(float(travel), 3),
                            },
                            {
                                "direction": [-float(c) for c in first],
                                "distance": round(hop, 3),
                            },
                        ],
                    },
                    confidence="low",
                    removal_direction=[float(c) for c in first],
                )

    return None


def _exit_travel(
    part: _Part,
    static_min: np.ndarray,
    static_max: np.ndarray,
    direction: np.ndarray,
    base_offset: np.ndarray | None = None,
) -> float:
    """Distance along `direction` until the part's AABB clears the assembly.

    AABB overlap ends as soon as the boxes separate on ANY axis, so the
    travel is the cheapest separating axis (taking the max instead explodes
    for directions with tiny components). Capped at the assembly diagonal
    and never zero: a part already outside still gets an animation travel
    of its own extent plus margin so the insertion reads clearly.
    """
    bbox_min = part.bbox_min + (base_offset if base_offset is not None else 0.0)
    bbox_max = part.bbox_max + (base_offset if base_offset is not None else 0.0)

    travel = float("inf")
    for axis in range(3):
        d = float(direction[axis])
        if d > 1e-6:
            needed = float(static_max[axis] - bbox_min[axis])
            travel = min(travel, max(needed / d, 0.0))
        elif d < -1e-6:
            needed = float(bbox_max[axis] - static_min[axis])
            travel = min(travel, max(needed / -d, 0.0))
    if travel == float("inf"):
        travel = 0.0

    diagonal = float(np.linalg.norm(static_max - static_min))
    travel = min(travel, diagonal * 1.5)

    extent = float(np.abs(direction) @ (bbox_max - bbox_min))
    return max(travel, extent) + EXIT_MARGIN_MM


def _path_is_clear(
    part: _Part,
    manager,
    direction: np.ndarray,
    start: float,
    end: float,
    samples: int,
    base_offset: np.ndarray | None = None,
) -> bool:
    """Densely sample translations of the part and check for collisions.

    Surface contact up to PENETRATION_TOLERANCE_MM is allowed so sliding
    fits (pins in bores, rails in channels) remain removable.
    """
    if end <= start:
        return False
    offsets = np.linspace(start, end, samples, endpoint=True)[1:]
    transform = np.eye(4)
    for s in offsets:
        translation = direction * float(s)
        if base_offset is not None:
            translation = translation + base_offset
        transform[:3, 3] = translation
        is_colliding, contacts = manager.in_collision_single(
            part.mesh, transform=transform, return_data=True
        )
        if is_colliding:
            depth = max((contact.depth for contact in contacts), default=0.0)
            if depth > PENETRATION_TOLERANCE_MM:
                return False
    return True


def _blockers(part: _Part, remaining: dict[str, _Part], trimesh_mod) -> list[str]:
    """Parts whose bounding boxes overlap this part's (rough blocking set)."""
    blockers: list[str] = []
    for other in remaining.values():
        if other.node_id == part.node_id:
            continue
        overlaps = bool(
            np.all(part.bbox_min <= other.bbox_max)
            and np.all(other.bbox_min <= part.bbox_max)
        )
        if overlaps:
            blockers.append(other.node_id)
    return blockers[:8]
