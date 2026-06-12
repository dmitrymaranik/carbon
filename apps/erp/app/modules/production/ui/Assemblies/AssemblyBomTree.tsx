import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import type { AssemblyGraphIndex, PartGroup } from "@carbon/viewer";
import { describeStep } from "@carbon/viewer";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowDownAZ,
  LuArrowDownWideNarrow,
  LuBlocks,
  LuEye,
  LuEyeOff,
  LuFolderTree,
  LuSettings,
  LuSquareStack,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { assemblyGroupTypes } from "../../production.models";
import type { FlattenedBomMaterial } from "../../production.service";
import { toViewerStep } from "../../production.service";
import type {
  AssemblyGroup,
  AssemblyInstructionStepRow,
  AssemblyPartMapping
} from "../../types";
import { PartColorSwatch } from "./AssemblyStepBom";

type SortMode = "count" | "alpha";
type GroupType = (typeof assemblyGroupTypes)[number];

type AssemblyBomTreeProps = {
  graphIndex: AssemblyGraphIndex | null;
  steps: AssemblyInstructionStepRow[];
  groups: AssemblyGroup[];
  isDisabled: boolean;
  modelUploadId: string | null;
  partMappings: AssemblyPartMapping[];
  bomMaterials: FlattenedBomMaterial[];
  onHighlightParts: (nodeIds: string[]) => void;
  onHideParts: (nodeIds: string[]) => void;
  onSelectStep: (stepId: string) => void;
};

/**
 * Bill of materials derived from the model's assembly graph: every distinct
 * part with its instance count, plus authored part groups (clusters, kits,
 * combinations, subassemblies). Selecting rows highlights all instances in
 * the viewer; selections can be grouped via the toolbar or right-click menu.
 * Parts map to engineering BOM items (methodMaterial) by geometry hash —
 * auto-matched by name/quantity, adjustable per part in the detail popover.
 */
export default function AssemblyBomTree({
  graphIndex,
  steps,
  groups,
  isDisabled,
  modelUploadId,
  partMappings,
  bomMaterials,
  onHighlightParts,
  onHideParts,
  onSelectStep
}: AssemblyBomTreeProps) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();
  const canGroup = !isDisabled && permissions.can("create", "production");
  const canMap =
    !isDisabled &&
    permissions.can("update", "production") &&
    Boolean(modelUploadId);

  const autoMatchFetcher = useFetcher<{ success: boolean }>();
  const mappingsByHash = useMemo(
    () =>
      new Map(partMappings.map((mapping) => [mapping.geometryHash, mapping])),
    [partMappings]
  );

  const [sortMode, setSortMode] = useState<SortMode>("count");
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(new Set());
  const [groupModalType, setGroupModalType] = useState<GroupType | null>(null);
  const lastClickedIndexRef = useRef<number | null>(null);

  const partGroups = useMemo(() => {
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

  const selectedNodeIds = useMemo(
    () =>
      partGroups
        .filter((group) => selectedKeys.has(group.key))
        .flatMap((group) => group.nodeIds),
    [partGroups, selectedKeys]
  );

  // Hidden parts: union of all hidden part-group keys
  useEffect(() => {
    onHideParts(
      partGroups
        .filter((group) => hiddenKeys.has(group.key))
        .flatMap((group) => group.nodeIds)
    );
  }, [hiddenKeys, partGroups, onHideParts]);

  const applySelection = (next: ReadonlySet<string>) => {
    setSelectedKeys(next);
    setSelectedGroupId(null);
    onHighlightParts(
      partGroups
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
        const inRange = partGroups[i];
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

  const onToggleGroupHighlight = (group: AssemblyGroup) => {
    if (selectedGroupId === group.id) {
      setSelectedGroupId(null);
      onHighlightParts([]);
      return;
    }
    setSelectedKeys(new Set());
    setSelectedGroupId(group.id);
    onHighlightParts(group.partNodeIds ?? []);
  };

  const onHideSelection = () => {
    const next = new Set(hiddenKeys);
    for (const key of selectedKeys) next.add(key);
    setHiddenKeys(next);
    applySelection(new Set());
  };

  const onShowAll = () => setHiddenKeys(new Set());

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: partGroups.length,
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
      {groups.length > 0 && (
        <div className="w-full flex-none border-b border-border">
          <h4 className="px-3 pt-2 text-xxs text-foreground/70 uppercase font-light tracking-wide">
            Groups
          </h4>
          <ul className="w-full pb-1">
            {groups.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                instructionId={id}
                isSelected={selectedGroupId === group.id}
                isDisabled={isDisabled}
                onClick={() => onToggleGroupHighlight(group)}
              />
            ))}
          </ul>
        </div>
      )}
      <div className="flex w-full flex-none items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground tabular-nums">
          {selectedKeys.size > 0
            ? `${selectedKeys.size} selected`
            : bomMaterials.length > 0
              ? `${partGroups.length} parts · ${mappingsByHash.size} mapped to BOM`
              : `${partGroups.length} part${partGroups.length === 1 ? "" : "s"} · ${graphIndex.graph.partCount} instance${graphIndex.graph.partCount === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-1">
          {selectedKeys.size === 0 && canMap && bomMaterials.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              isDisabled={autoMatchFetcher.state !== "idle"}
              isLoading={autoMatchFetcher.state !== "idle"}
              onClick={() => {
                autoMatchFetcher.submit(new FormData(), {
                  method: "post",
                  action: path.to.autoMatchAssemblyParts(id)
                });
              }}
            >
              Match BOM
            </Button>
          )}
          {selectedKeys.size > 0 && canGroup && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" leftIcon={<LuBlocks />}>
                  Group
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {selectionGroupTypes.map(({ type, label, icon: Icon }) => (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => setGroupModalType(type)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {selectedKeys.size > 0 && (
            <IconButton
              aria-label="Hide selected parts"
              icon={<LuEyeOff />}
              variant="ghost"
              size="sm"
              onClick={onHideSelection}
            />
          )}
          {hiddenKeys.size > 0 && (
            <IconButton
              aria-label="Show all hidden parts"
              icon={<LuEye />}
              variant="ghost"
              size="sm"
              onClick={onShowAll}
            />
          )}
          <IconButton
            aria-label={
              sortMode === "count" ? "Sort alphabetically" : "Sort by count"
            }
            icon={
              sortMode === "count" ? (
                <LuArrowDownWideNarrow />
              ) : (
                <LuArrowDownAZ />
              )
            }
            variant="ghost"
            size="sm"
            onClick={() =>
              setSortMode((mode) => (mode === "count" ? "alpha" : "count"))
            }
          />
        </div>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
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
                const group = partGroups[virtualRow.index];
                if (!group) return null;
                return (
                  <BomRow
                    key={group.key}
                    group={group}
                    isSelected={selectedKeys.has(group.key)}
                    isHidden={hiddenKeys.has(group.key)}
                    usage={stepUsage.get(group.key) ?? []}
                    mapping={mappingsByHash.get(group.key) ?? null}
                    bomMaterials={bomMaterials}
                    canMap={canMap}
                    modelUploadId={modelUploadId}
                    instructionId={id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                    onClick={(event) =>
                      onRowClick(event, group, virtualRow.index)
                    }
                    onSelectStep={onSelectStep}
                  />
                );
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {selectionGroupTypes.map(({ type, label, icon: Icon }) => (
            <ContextMenuItem
              key={type}
              disabled={!canGroup || selectedKeys.size === 0}
              onClick={() => setGroupModalType(type)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={selectedKeys.size === 0}
            onClick={onHideSelection}
          >
            <LuEyeOff className="mr-2 h-4 w-4" />
            Hide selected parts
          </ContextMenuItem>
          <ContextMenuItem disabled={hiddenKeys.size === 0} onClick={onShowAll}>
            <LuEye className="mr-2 h-4 w-4" />
            Show all hidden parts
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selectedKeys.size === 0}
            onClick={() => applySelection(new Set())}
          >
            Clear selection
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {groupModalType && (
        <CreateGroupModal
          type={groupModalType}
          instructionId={id}
          partNodeIds={selectedNodeIds}
          onClose={() => setGroupModalType(null)}
          onCreated={() => {
            setGroupModalType(null);
            applySelection(new Set());
          }}
        />
      )}
    </div>
  );
}

const selectionGroupTypes: {
  type: GroupType;
  label: string;
  icon: typeof LuBlocks;
}[] = [
  { type: "Cluster", label: "Create cluster", icon: LuFolderTree },
  { type: "Kit", label: "Create kit", icon: LuSquareStack },
  { type: "Combination", label: "Create combination", icon: LuBlocks },
  { type: "Subassembly", label: "Create subassembly", icon: LuBlocks }
];

const groupTypeDescriptions: Record<GroupType, string> = {
  Cluster: "A visual grouping of parts in the tree",
  Kit: "Parts that are always picked and staged together",
  Combination: "Parts treated as one logical unit in steps",
  Subassembly: "Gets its own child instruction with its own build sequence"
};

function GroupRow({
  group,
  instructionId,
  isSelected,
  isDisabled,
  onClick
}: {
  group: AssemblyGroup;
  instructionId: string;
  isSelected: boolean;
  isDisabled: boolean;
  onClick: () => void;
}) {
  const permissions = usePermissions();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  if (deleteFetcher.state !== "idle") return null;

  return (
    <li
      className={cn(
        "group flex w-full cursor-pointer select-none items-center gap-2 px-3 py-1 text-sm hover:bg-accent/30",
        isSelected && "bg-accent/50 hover:bg-accent/50"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter") onClick();
      }}
    >
      <Badge variant="secondary" className="shrink-0">
        {group.type}
      </Badge>
      <span className="min-w-0 flex-1 truncate" title={group.name}>
        {group.type === "Subassembly" && group.childInstructionId ? (
          <Link
            to={path.to.assemblyInstruction(group.childInstructionId)}
            className="hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {group.name}
          </Link>
        ) : (
          group.name
        )}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {group.partNodeIds?.length ?? 0}
      </span>
      {!isDisabled && permissions.can("delete", "production") && (
        <IconButton
          aria-label={`Delete group ${group.name}`}
          icon={<LuTrash />}
          variant="ghost"
          size="sm"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            deleteFetcher.submit(new FormData(), {
              method: "post",
              action: path.to.deleteAssemblyGroup(instructionId, group.id)
            });
          }}
        />
      )}
    </li>
  );
}

function CreateGroupModal({
  type,
  instructionId,
  partNodeIds,
  onClose,
  onCreated
}: {
  type: GroupType;
  instructionId: string;
  partNodeIds: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  const [name, setName] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      onCreated();
    }
  }, [fetcher.state, fetcher.data, onCreated]);

  const onSubmit = () => {
    if (!name.trim()) return;
    const formData = new FormData();
    formData.append("assemblyInstructionId", instructionId);
    formData.append("name", name.trim());
    formData.append("type", type);
    formData.append("partNodeIds", JSON.stringify(partNodeIds));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.newAssemblyGroup(instructionId)
    });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Create {type.toLowerCase()}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={3} className="w-full">
            <p className="text-sm text-muted-foreground">
              {groupTypeDescriptions[type]} · {partNodeIds.length} part
              {partNodeIds.length === 1 ? "" : "s"} selected
            </p>
            <Input
              aria-label="Group name"
              placeholder={`${type} name`}
              value={name}
              autoFocus
              onChange={(nameEvent) => setName(nameEvent.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit();
              }}
            />
            <Button
              className="self-end"
              isDisabled={!name.trim() || fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
              onClick={onSubmit}
            >
              Create
            </Button>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

function BomRow({
  group,
  isSelected,
  isHidden,
  usage,
  mapping,
  bomMaterials,
  canMap,
  modelUploadId,
  instructionId,
  style,
  onClick,
  onSelectStep
}: {
  group: PartGroup;
  isSelected: boolean;
  isHidden: boolean;
  usage: { stepId: string; index: number; title: string }[];
  mapping: AssemblyPartMapping | null;
  bomMaterials: FlattenedBomMaterial[];
  canMap: boolean;
  modelUploadId: string | null;
  instructionId: string;
  style: React.CSSProperties;
  onClick: (event: MouseEvent) => void;
  onSelectStep: (stepId: string) => void;
}) {
  const bomLine = mapping
    ? bomMaterials.find((material) => material.itemId === mapping.itemId)
    : undefined;
  const quantityMismatch =
    bomLine !== undefined && Math.round(bomLine.quantity) !== group.count;

  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      className={cn(
        "group flex cursor-pointer select-none items-center gap-2 border-b border-border px-3 text-sm hover:bg-accent/30",
        isSelected && "bg-accent/50 hover:bg-accent/50",
        isHidden && "opacity-50"
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
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={group.name}>
          {group.name}
        </span>
        {mapping?.item && (
          <span
            className={cn(
              "truncate text-xs",
              quantityMismatch ? "text-yellow-600" : "text-muted-foreground"
            )}
            title={mapping.item.name ?? undefined}
          >
            {mapping.item.readableIdWithRevision}
            {quantityMismatch &&
              bomLine &&
              ` · BOM qty ${Math.round(bomLine.quantity)} ≠ model ${group.count}`}
          </span>
        )}
      </div>
      {isHidden && (
        <LuEyeOff
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-label="Hidden"
        />
      )}
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
            mapping={mapping}
            bomMaterials={bomMaterials}
            canMap={canMap}
            modelUploadId={modelUploadId}
            instructionId={instructionId}
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
  mapping,
  bomMaterials,
  canMap,
  modelUploadId,
  instructionId,
  onSelectStep
}: {
  group: PartGroup;
  usage: { stepId: string; index: number; title: string }[];
  mapping: AssemblyPartMapping | null;
  bomMaterials: FlattenedBomMaterial[];
  canMap: boolean;
  modelUploadId: string | null;
  instructionId: string;
  onSelectStep: (stepId: string) => void;
}) {
  const mapFetcher = useFetcher<{ success: boolean }>();
  const size = [
    group.bbox.max[0] - group.bbox.min[0],
    group.bbox.max[1] - group.bbox.min[1],
    group.bbox.max[2] - group.bbox.min[2]
  ];

  const onMap = (itemId: string) => {
    if (!modelUploadId) return;
    const formData = new FormData();
    formData.append("modelUploadId", modelUploadId);
    formData.append("geometryHash", group.key);
    formData.append("itemId", itemId);
    mapFetcher.submit(formData, {
      method: "post",
      action: path.to.newAssemblyPartMapping(instructionId)
    });
  };

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
      {bomMaterials.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Bill of materials</p>
          {mapping?.item ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {mapping.item.readableIdWithRevision} · {mapping.item.name}
              </span>
              {canMap && (
                <IconButton
                  aria-label="Remove BOM mapping"
                  icon={<LuTrash />}
                  variant="ghost"
                  size="sm"
                  isDisabled={mapFetcher.state !== "idle"}
                  onClick={() => {
                    mapFetcher.submit(new FormData(), {
                      method: "post",
                      action: path.to.deleteAssemblyPartMapping(
                        instructionId,
                        mapping.id
                      )
                    });
                  }}
                />
              )}
            </div>
          ) : canMap ? (
            <ul className="flex max-h-36 flex-col overflow-y-auto">
              {bomMaterials.map((material) => (
                <li key={`${material.itemId}-${material.depth}`}>
                  <button
                    type="button"
                    className="w-full truncate rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                    disabled={mapFetcher.state !== "idle"}
                    title={material.name ?? undefined}
                    onClick={() => onMap(material.itemId)}
                  >
                    <span className="text-muted-foreground tabular-nums mr-1">
                      ×{Math.round(material.quantity)}
                    </span>
                    {material.readableIdWithRevision} · {material.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Not mapped</p>
          )}
        </div>
      )}
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
