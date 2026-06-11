import { describe, expect, it } from "vitest";
import { describeStep } from "./describe";
import { groupPartNodeIds, indexAssemblyGraph } from "./graph";
import type { AssemblyGraph, AssemblyGraphNode } from "./types";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function leaf(
  nodeId: string,
  name: string,
  geometryHash: string | null
): AssemblyGraphNode {
  return {
    nodeId,
    name,
    isAssembly: false,
    geometryHash,
    transform: IDENTITY,
    bbox: { min: [0, 0, 0], max: [10, 20, 30] },
    volume: 1000,
    color: [0.5, 0.5, 0.5, 1],
    children: []
  };
}

function assembly(
  nodeId: string,
  name: string,
  children: AssemblyGraphNode[]
): AssemblyGraphNode {
  return {
    nodeId,
    name,
    isAssembly: true,
    geometryHash: null,
    transform: IDENTITY,
    bbox: { min: [0, 0, 0], max: [10, 20, 30] },
    volume: null,
    color: null,
    children
  };
}

const graph: AssemblyGraph = {
  version: 1,
  unit: "mm",
  sourceUnit: "mm",
  partCount: 5,
  root: assembly("root", "Assembly", [
    leaf("bolt-1", "M8 Bolt", "hash-bolt"),
    leaf("bolt-2", "M8 Bolt", "hash-bolt"),
    assembly("sub", "Bracket Sub", [
      leaf("bolt-3", "M8 Bolt", "hash-bolt"),
      leaf("plate-1", "Base Plate", "hash-plate")
    ]),
    leaf("gasket-1", "Gasket", null)
  ])
};

describe("indexAssemblyGraph", () => {
  const index = indexAssemblyGraph(graph);

  it("indexes every node by nodeId", () => {
    expect(index.nodesById.size).toBe(7);
    expect(index.nodesById.get("sub")?.isAssembly).toBe(true);
  });

  it("collects leaves depth-first", () => {
    expect(index.leaves.map((node) => node.nodeId)).toEqual([
      "bolt-1",
      "bolt-2",
      "bolt-3",
      "plate-1",
      "gasket-1"
    ]);
  });

  it("groups identical geometry across subassemblies", () => {
    const bolts = index.groups.find((group) => group.key === "hash-bolt");
    expect(bolts?.count).toBe(3);
    expect(bolts?.nodeIds).toEqual(["bolt-1", "bolt-2", "bolt-3"]);
  });

  it("falls back to a name key for leaves without a geometry hash", () => {
    const gasket = index.groupByNodeId.get("gasket-1");
    expect(gasket?.key).toBe("name:Gasket");
    expect(gasket?.count).toBe(1);
  });
});

describe("groupPartNodeIds", () => {
  const index = indexAssemblyGraph(graph);

  it("groups only the given ids", () => {
    const groups = groupPartNodeIds(["bolt-1", "bolt-3", "plate-1"], index);
    expect(groups.map((group) => [group.name, group.count])).toEqual([
      ["M8 Bolt", 2],
      ["Base Plate", 1]
    ]);
  });

  it("skips unknown/stale nodeIds", () => {
    const groups = groupPartNodeIds(["bolt-1", "gone-1"], index);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(1);
  });

  it("does not mutate the index groups", () => {
    groupPartNodeIds(["bolt-1"], index);
    const bolts = index.groups.find((group) => group.key === "hash-bolt");
    expect(bolts?.count).toBe(3);
  });
});

describe("describeStep", () => {
  const index = indexAssemblyGraph(graph);

  it("uses an explicit title verbatim", () => {
    expect(
      describeStep(
        { title: "Torque the head", partNodeIds: ["bolt-1"], fastener: null },
        index
      )
    ).toBe("Torque the head");
  });

  it("describes a single part", () => {
    expect(
      describeStep(
        { title: null, partNodeIds: ["plate-1"], fastener: null },
        index
      )
    ).toBe("Add Base Plate");
  });

  it("counts duplicate parts and appends the fastener spec", () => {
    expect(
      describeStep(
        {
          title: null,
          partNodeIds: ["bolt-1", "bolt-2", "bolt-3"],
          fastener: { spec: "M8 SHCS", count: 3 }
        },
        index
      )
    ).toBe("Add M8 Bolt (×3), M8 SHCS (×3)");
  });

  it("uses Assemble for multiple distinct parts", () => {
    expect(
      describeStep(
        { title: null, partNodeIds: ["plate-1", "gasket-1"], fastener: null },
        index
      )
    ).toBe("Assemble Base Plate, Gasket");
  });

  it("uses Install for fastener-only steps", () => {
    expect(
      describeStep(
        {
          title: null,
          partNodeIds: [],
          fastener: { spec: "M5 SHCS", count: 4 }
        },
        index
      )
    ).toBe("Install M5 SHCS (×4)");
  });

  it("returns null when there is nothing to describe", () => {
    expect(
      describeStep({ title: null, partNodeIds: [], fastener: null }, index)
    ).toBeNull();
    expect(
      describeStep(
        { title: null, partNodeIds: ["gone"], fastener: null },
        index
      )
    ).toBeNull();
    expect(
      describeStep(
        { title: null, partNodeIds: ["bolt-1"], fastener: null },
        null
      )
    ).toBeNull();
  });
});
