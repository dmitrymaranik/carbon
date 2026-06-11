import {
  Badge,
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import type { AssemblyGraphIndex, PartGroup } from "@carbon/viewer";
import { describeStep } from "@carbon/viewer";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent } from "react";
import { useMemo, useRef, useState } from "react";
import {
  LuArrowDownAZ,
  LuArrowDownWideNarrow,
  LuSettings
} from "react-icons/lu";
import { Empty } from "~/components";
import { toViewerStep } from "../../assembly.utils";
import type { AssemblyInstructionStepRow } from "../../types";
import { PartColorSwatch } from "./AssemblyStepBom";

type SortMode = "count" | "alpha";

type AssemblyBomTreeProps = {
  graphIndex: AssemblyGraphIndex | null;
  steps: AssemblyInstructionStepRow[];
  onHighlightParts: (nodeIds: string[]) => void;
  onSelectStep: (stepId: string) => void;
};

/**
 * Bill of materials derived from the model's assembly graph: every distinct
 * part with its instance count. Selecting rows highlights all instances in
 * the viewer (cmd/ctrl toggles, shift selects a range).
 */
export default function AssemblyBomTree({
  graphIndex,
  steps,
  onHighlightParts,
  onSelectStep
}: AssemblyBomTreeProps) {
  const [sortMode, setSortMode] = useState<SortMode>("count");
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(
    new Set()
  );
  const lastClickedIndexRef = useRef<number | null>(null);

  const groups = useMemo(() => {
    if (!graphIndex) return [];
    const sorted = [...graphIndex.groups];
    if (sortMode === "count") {
      sorted.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [graphIndex, sortMode]);

  /** groupKey → steps that install instances of the part */
  const stepUsage = useMemo(() => {
    const usage = new Map<
      string,
      { stepId: string; index: number; title: string }[]
    >();
    if (!graphIndex) return usage;
    steps.forEach((step, index) => {
      const seen = new Set<string>();
      for (const nodeId of step.partNodeIds ?? []) {
        const group = graphIndex.groupByNodeId.get(nodeId);
        if (!group || seen.has(group.key)) continue;
        seen.add(group.key);
        const entry = usage.get(group.key) ?? [];
        entry.push({
          stepId: step.id,
          index,
          title: describeStep(toViewerStep(step), graphIndex) ?? "Untitled step"
        });
        usage.set(group.key, entry);
      }
    });
    return usage;
  }, [steps, graphIndex]);

  const applySelection = (next: ReadonlySet<string>) => {
    setSelectedKeys(next);
    onHighlightParts(
      groups
        .filter((group) => next.has(group.key))
        .flatMap((group) => group.nodeIds)
    );
  };

  const onRowClick = (
    event: MouseEvent,
    group: PartGroup,
    rowIndex: number
  ) => {
    let next: Set<string>;
    if (event.shiftKey && lastClickedIndexRef.current !== null) {
      next = new Set(selectedKeys);
      const start = Math.min(lastClickedIndexRef.current, rowIndex);
      const end = Math.max(lastClickedIndexRef.current, rowIndex);
      for (let i = start; i <= end; i++) {
        const inRange = groups[i];
        if (inRange) next.add(inRange.key);
      }
    } else if (event.metaKey || event.ctrlKey) {
      next = new Set(selectedKeys);
      if (next.has(group.key)) {
        next.delete(group.key);
      } else {
        next.add(group.key);
      }
    } else if (selectedKeys.size === 1 && selectedKeys.has(group.key)) {
      // Clicking the only selected row clears the highlight
      next = new Set();
    } else {
      next = new Set([group.key]);
    }
    lastClickedIndexRef.current = rowIndex;
    applySelection(next);
  };

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12
  });

  if (!graphIndex) {
    return (
      <Empty className="border-none">
        <p className="text-sm text-muted-foreground max-w-[280px] text-center">
          The bill of materials appears here once the model loads
        </p>
      </Empty>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex w-full flex-none items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground tabular-nums">
          {groups.length} part{groups.length === 1 ? "" : "s"} ·{" "}
          {graphIndex.graph.partCount} instance
          {graphIndex.graph.partCount === 1 ? "" : "s"}
        </span>
        <IconButton
          aria-label={
            sortMode === "count" ? "Sort alphabetically" : "Sort by count"
          }
          icon={
            sortMode === "count" ? <LuArrowDownWideNarrow /> : <LuArrowDownAZ />
          }
          variant="ghost"
          size="sm"
          onClick={() =>
            setSortMode((mode) => (mode === "count" ? "alpha" : "count"))
          }
        />
      </div>
      <div
        ref={parentRef}
        className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
        onKeyDown={(event) => {
          if (event.key === "Escape" && selectedKeys.size > 0) {
            applySelection(new Set());
          }
        }}
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const group = groups[virtualRow.index];
            if (!group) return null;
            return (
              <BomRow
                key={group.key}
                group={group}
                isSelected={selectedKeys.has(group.key)}
                usage={stepUsage.get(group.key) ?? []}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`
                }}
                onClick={(event) => onRowClick(event, group, virtualRow.index)}
                onSelectStep={onSelectStep}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BomRow({
  group,
  isSelected,
  usage,
  style,
  onClick,
  onSelectStep
}: {
  group: PartGroup;
  isSelected: boolean;
  usage: { stepId: string; index: number; title: string }[];
  style: React.CSSProperties;
  onClick: (event: MouseEvent) => void;
  onSelectStep: (stepId: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      className={cn(
        "group flex cursor-pointer select-none items-center gap-2 border-b border-border px-3 text-sm hover:bg-accent/30",
        isSelected && "bg-accent/50 hover:bg-accent/50"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(event as unknown as MouseEvent);
        }
      }}
    >
      <PartColorSwatch color={group.color} />
      <span className="min-w-0 flex-1 truncate" title={group.name}>
        {group.name}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        — {group.count}
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <IconButton
            aria-label={`Part details: ${group.name}`}
            icon={<LuSettings />}
            variant="ghost"
            size="sm"
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
            onClick={(event) => event.stopPropagation()}
          />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-72 text-sm"
          onClick={(event) => event.stopPropagation()}
        >
          <PartDetails
            group={group}
            usage={usage}
            onSelectStep={onSelectStep}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PartDetails({
  group,
  usage,
  onSelectStep
}: {
  group: PartGroup;
  usage: { stepId: string; index: number; title: string }[];
  onSelectStep: (stepId: string) => void;
}) {
  const size = [
    group.bbox.max[0] - group.bbox.min[0],
    group.bbox.max[1] - group.bbox.min[1],
    group.bbox.max[2] - group.bbox.min[2]
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <PartColorSwatch color={group.color} />
        <p className="min-w-0 flex-1 truncate font-medium" title={group.name}>
          {group.name}
        </p>
        <Badge variant="secondary" className="tabular-nums">
          ×{group.count}
        </Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Size</dt>
        <dd className="tabular-nums">
          {size.map((dim) => formatLength(dim)).join(" × ")} mm
        </dd>
        <dt className="text-muted-foreground">Volume</dt>
        <dd className="tabular-nums">{formatVolume(group.volume)}</dd>
      </dl>
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">Used in steps</p>
        {usage.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Not referenced by any step
          </p>
        ) : (
          <ul className="flex flex-col">
            {usage.map((entry) => (
              <li key={entry.stepId}>
                <button
                  type="button"
                  className="w-full truncate rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent"
                  title={entry.title}
                  onClick={() => onSelectStep(entry.stepId)}
                >
                  <span className="text-muted-foreground tabular-nums mr-1">
                    {entry.index + 1}.
                  </span>
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatLength(mm: number): string {
  return mm >= 100 ? mm.toFixed(0) : mm.toFixed(1);
}

function formatVolume(mm3: number | null): string {
  if (mm3 === null) return "—";
  if (mm3 >= 1000) return `${(mm3 / 1000).toFixed(1)} cm³`;
  return `${mm3.toFixed(0)} mm³`;
}
