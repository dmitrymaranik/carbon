import {
  Hidden,
  Input,
  Number,
  Submit,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  Input as InputBase,
  Label,
  ToggleGroup,
  ToggleGroupItem,
  VStack
} from "@carbon/react";
import { useMemo, useState } from "react";
import { useFetcher, useParams } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  assemblyInstructionStepValidator,
  fastenerSchema,
  motionSchema
} from "../../assembly.models";
import type { AssemblyInstructionStepRow } from "../../types";

type AssemblyInstructionPropertiesProps = {
  step: AssemblyInstructionStepRow | null;
  draftPartNodeIds: string[] | null;
  isDisabled: boolean;
};

const AssemblyInstructionProperties = ({
  step,
  draftPartNodeIds,
  isDisabled
}: AssemblyInstructionPropertiesProps) => {
  return (
    <VStack
      spacing={4}
      className="w-[450px] bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          Step
        </h3>
      </VStack>
      {step ? (
        <StepForm
          key={step.id}
          step={step}
          draftPartNodeIds={draftPartNodeIds}
          isDisabled={isDisabled}
        />
      ) : (
        <Empty className="border-none">Select a step to edit it</Empty>
      )}
    </VStack>
  );
};

export default AssemblyInstructionProperties;

const motionTypes = ["none", "linear", "L", "helix"] as const;
type MotionType = (typeof motionTypes)[number];

type Vec3Draft = [string, string, string];

type MotionDraft = {
  type: MotionType;
  direction: Vec3Draft;
  distance: string;
  segments: { direction: Vec3Draft; distance: string }[];
  axis: Vec3Draft;
  origin: Vec3Draft;
  pitch: string;
  turns: string;
  approach: string;
};

const zeroVector: Vec3Draft = ["0", "0", "0"];

function toVec3Draft(vector?: [number, number, number]): Vec3Draft {
  if (!vector) return zeroVector;
  return [String(vector[0]), String(vector[1]), String(vector[2])];
}

function makeMotionDraft(motion: unknown): MotionDraft {
  const draft: MotionDraft = {
    type: "none",
    direction: ["0", "0", "-1"],
    distance: "50",
    segments: [
      { direction: ["1", "0", "0"], distance: "50" },
      { direction: ["0", "0", "-1"], distance: "20" }
    ],
    axis: ["0", "0", "-1"],
    origin: zeroVector,
    pitch: "1",
    turns: "5",
    approach: "10"
  };

  const parsed = motionSchema.safeParse(motion);
  if (!parsed.success) return draft;

  const value = parsed.data;
  switch (value.type) {
    case "linear":
      return {
        ...draft,
        type: "linear",
        direction: toVec3Draft(value.direction),
        distance: String(value.distance)
      };
    case "L":
      return {
        ...draft,
        type: "L",
        segments: value.segments.map((segment) => ({
          direction: toVec3Draft(segment.direction),
          distance: String(segment.distance)
        }))
      };
    case "helix":
      return {
        ...draft,
        type: "helix",
        axis: toVec3Draft(value.axis),
        origin: toVec3Draft(value.origin),
        pitch: String(value.pitch),
        turns: String(value.turns),
        approach: String(value.approach)
      };
    case "path":
      // Path motions are not editable in Phase 0 — leave the saved value alone
      return { ...draft, type: "none" };
    default:
      return draft;
  }
}

function parseVec3(vector: Vec3Draft): [number, number, number] {
  return [
    globalThis.Number(vector[0]),
    globalThis.Number(vector[1]),
    globalThis.Number(vector[2])
  ];
}

function serializeMotion(draft: MotionDraft): unknown {
  switch (draft.type) {
    case "linear":
      return {
        type: "linear",
        direction: parseVec3(draft.direction),
        distance: globalThis.Number(draft.distance)
      };
    case "L":
      return {
        type: "L",
        segments: draft.segments.map((segment) => ({
          direction: parseVec3(segment.direction),
          distance: globalThis.Number(segment.distance)
        }))
      };
    case "helix":
      return {
        type: "helix",
        axis: parseVec3(draft.axis),
        origin: parseVec3(draft.origin),
        pitch: globalThis.Number(draft.pitch),
        turns: globalThis.Number(draft.turns),
        approach: globalThis.Number(draft.approach)
      };
    default:
      return { type: "none" };
  }
}

type FastenerDraft = {
  spec: string;
  count: string;
  torqueNm: string;
  tool: string;
};

function makeFastenerDraft(fastener: unknown): FastenerDraft {
  const parsed = fastenerSchema.safeParse(fastener);
  if (!parsed.success) {
    return { spec: "", count: "", torqueNm: "", tool: "" };
  }
  return {
    spec: parsed.data.spec ?? "",
    count: parsed.data.count !== undefined ? String(parsed.data.count) : "",
    torqueNm:
      parsed.data.torqueNm !== undefined ? String(parsed.data.torqueNm) : "",
    tool: parsed.data.tool ?? ""
  };
}

function serializeFastener(draft: FastenerDraft): unknown {
  const fastener: Record<string, unknown> = {};
  if (draft.spec.trim()) fastener.spec = draft.spec.trim();
  if (draft.count.trim()) fastener.count = globalThis.Number(draft.count);
  if (draft.torqueNm.trim())
    fastener.torqueNm = globalThis.Number(draft.torqueNm);
  if (draft.tool.trim()) fastener.tool = draft.tool.trim();
  return Object.keys(fastener).length > 0 ? fastener : null;
}

function StepForm({
  step,
  draftPartNodeIds,
  isDisabled
}: {
  step: AssemblyInstructionStepRow;
  draftPartNodeIds: string[] | null;
  isDisabled: boolean;
}) {
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");

  const permissions = usePermissions();
  const fetcher = useFetcher<{ success: boolean }>();

  const [motion, setMotion] = useState<MotionDraft>(() =>
    makeMotionDraft(step.motion)
  );
  const [fastener, setFastener] = useState<FastenerDraft>(() =>
    makeFastenerDraft(step.fastener)
  );

  const partNodeIds = draftPartNodeIds ?? step.partNodeIds ?? [];
  const hasUnsavedParts =
    draftPartNodeIds !== null &&
    JSON.stringify(draftPartNodeIds) !== JSON.stringify(step.partNodeIds ?? []);

  const serializedMotion = useMemo(() => serializeMotion(motion), [motion]);
  const motionValidation = useMemo(
    () => motionSchema.safeParse(serializedMotion),
    [serializedMotion]
  );

  const serializedFastener = useMemo(
    () => serializeFastener(fastener),
    [fastener]
  );
  const fastenerValidation = useMemo(
    () => fastenerSchema.nullable().safeParse(serializedFastener),
    [serializedFastener]
  );

  const cannotSave =
    isDisabled ||
    !permissions.can("update", "assembly") ||
    !motionValidation.success ||
    !fastenerValidation.success;

  return (
    <ValidatedForm
      validator={assemblyInstructionStepValidator}
      method="post"
      action={path.to.assemblyInstructionStep(instructionId, step.id)}
      defaultValues={{
        id: step.id,
        assemblyInstructionId: instructionId,
        title: step.title ?? "",
        instructionText: step.instructionText ?? "",
        durationSeconds: step.durationSeconds ?? undefined
      }}
      fetcher={fetcher}
      className="w-full"
    >
      <Hidden name="id" />
      <Hidden name="assemblyInstructionId" />
      <Hidden name="partNodeIds" value={JSON.stringify(partNodeIds)} />
      <Hidden name="motion" value={JSON.stringify(serializedMotion)} />
      <Hidden name="fastener" value={JSON.stringify(serializedFastener)} />
      <VStack spacing={4} className="w-full pb-4">
        <Input name="title" label="Title" />
        <TextArea name="instructionText" label="Instruction" />

        <VStack spacing={2} className="w-full">
          <Label>Parts</Label>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">
              {partNodeIds.length} selected
            </Badge>
            {hasUnsavedParts && <Badge variant="outline">Unsaved</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Click parts in the viewer to assign them to this step. Hold shift to
            select multiple parts.
          </p>
        </VStack>

        <VStack spacing={2} className="w-full">
          <Label>Motion</Label>
          <ToggleGroup
            type="single"
            value={motion.type}
            onValueChange={(value) => {
              if (value && !isDisabled) {
                setMotion((previous) => ({
                  ...previous,
                  type: value as MotionType
                }));
              }
            }}
            className="justify-start"
          >
            <ToggleGroupItem value="none">None</ToggleGroupItem>
            <ToggleGroupItem value="linear">Linear</ToggleGroupItem>
            <ToggleGroupItem value="L">L</ToggleGroupItem>
            <ToggleGroupItem value="helix">Helix</ToggleGroupItem>
          </ToggleGroup>

          {motion.type === "linear" && (
            <>
              <VectorInput
                label="Direction"
                value={motion.direction}
                isDisabled={isDisabled}
                onChange={(direction) =>
                  setMotion((previous) => ({ ...previous, direction }))
                }
              />
              <ScalarInput
                label="Distance (mm)"
                value={motion.distance}
                isDisabled={isDisabled}
                onChange={(distance) =>
                  setMotion((previous) => ({ ...previous, distance }))
                }
              />
            </>
          )}

          {motion.type === "L" &&
            motion.segments.map((segment, index) => (
              <VStack
                key={`segment-${index}`}
                spacing={2}
                className="w-full rounded-lg border border-border p-2"
              >
                <Label>Segment {index + 1}</Label>
                <VectorInput
                  label="Direction"
                  value={segment.direction}
                  isDisabled={isDisabled}
                  onChange={(direction) =>
                    setMotion((previous) => ({
                      ...previous,
                      segments: previous.segments.map((s, i) =>
                        i === index ? { ...s, direction } : s
                      )
                    }))
                  }
                />
                <ScalarInput
                  label="Distance (mm)"
                  value={segment.distance}
                  isDisabled={isDisabled}
                  onChange={(distance) =>
                    setMotion((previous) => ({
                      ...previous,
                      segments: previous.segments.map((s, i) =>
                        i === index ? { ...s, distance } : s
                      )
                    }))
                  }
                />
              </VStack>
            ))}

          {motion.type === "helix" && (
            <>
              <VectorInput
                label="Axis"
                value={motion.axis}
                isDisabled={isDisabled}
                onChange={(axis) =>
                  setMotion((previous) => ({ ...previous, axis }))
                }
              />
              <VectorInput
                label="Origin"
                value={motion.origin}
                isDisabled={isDisabled}
                onChange={(origin) =>
                  setMotion((previous) => ({ ...previous, origin }))
                }
              />
              <div className="grid grid-cols-3 gap-2 w-full">
                <ScalarInput
                  label="Pitch (mm)"
                  value={motion.pitch}
                  isDisabled={isDisabled}
                  onChange={(pitch) =>
                    setMotion((previous) => ({ ...previous, pitch }))
                  }
                />
                <ScalarInput
                  label="Turns"
                  value={motion.turns}
                  isDisabled={isDisabled}
                  onChange={(turns) =>
                    setMotion((previous) => ({ ...previous, turns }))
                  }
                />
                <ScalarInput
                  label="Approach (mm)"
                  value={motion.approach}
                  isDisabled={isDisabled}
                  onChange={(approach) =>
                    setMotion((previous) => ({ ...previous, approach }))
                  }
                />
              </div>
            </>
          )}

          {!motionValidation.success && (
            <p className="text-xs text-destructive">
              Motion is invalid — distances, pitch and turns must be positive
              numbers
            </p>
          )}
        </VStack>

        <VStack spacing={2} className="w-full">
          <Label>Fastener</Label>
          <div className="grid grid-cols-2 gap-2 w-full">
            <FieldInput
              label="Spec"
              placeholder="M5 SHCS"
              value={fastener.spec}
              isDisabled={isDisabled}
              onChange={(spec) =>
                setFastener((previous) => ({ ...previous, spec }))
              }
            />
            <FieldInput
              label="Count"
              type="number"
              placeholder="4"
              value={fastener.count}
              isDisabled={isDisabled}
              onChange={(count) =>
                setFastener((previous) => ({ ...previous, count }))
              }
            />
            <FieldInput
              label="Torque (N·m)"
              type="number"
              placeholder="8"
              value={fastener.torqueNm}
              isDisabled={isDisabled}
              onChange={(torqueNm) =>
                setFastener((previous) => ({ ...previous, torqueNm }))
              }
            />
            <FieldInput
              label="Tool"
              placeholder="4mm hex"
              value={fastener.tool}
              isDisabled={isDisabled}
              onChange={(tool) =>
                setFastener((previous) => ({ ...previous, tool }))
              }
            />
          </div>
          {!fastenerValidation.success && (
            <p className="text-xs text-destructive">
              Fastener is invalid — count must be a whole number and torque must
              be positive
            </p>
          )}
        </VStack>

        <Number
          name="durationSeconds"
          label="Duration (seconds)"
          minValue={0}
        />

        <Submit
          isDisabled={cannotSave || fetcher.state !== "idle"}
          isLoading={fetcher.state !== "idle"}
        >
          Save Step
        </Submit>
      </VStack>
    </ValidatedForm>
  );
}

function VectorInput({
  label,
  value,
  isDisabled,
  onChange
}: {
  label: string;
  value: Vec3Draft;
  isDisabled: boolean;
  onChange: (value: Vec3Draft) => void;
}) {
  return (
    <VStack spacing={1} className="w-full">
      <Label>{label}</Label>
      <div className="grid grid-cols-3 gap-2 w-full">
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <InputBase
            key={axis}
            aria-label={`${label} ${axis}`}
            type="number"
            step="any"
            placeholder={axis}
            value={value[index]}
            isDisabled={isDisabled}
            onChange={(e) => {
              const next: Vec3Draft = [...value];
              next[index] = e.target.value;
              onChange(next);
            }}
          />
        ))}
      </div>
    </VStack>
  );
}

function ScalarInput({
  label,
  value,
  isDisabled,
  onChange
}: {
  label: string;
  value: string;
  isDisabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <VStack spacing={1} className="w-full">
      <Label>{label}</Label>
      <InputBase
        aria-label={label}
        type="number"
        step="any"
        value={value}
        isDisabled={isDisabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </VStack>
  );
}

function FieldInput({
  label,
  value,
  isDisabled,
  onChange,
  type = "text",
  placeholder
}: {
  label: string;
  value: string;
  isDisabled: boolean;
  onChange: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
}) {
  return (
    <VStack spacing={1} className="w-full">
      <Label>{label}</Label>
      <InputBase
        aria-label={label}
        type={type}
        step={type === "number" ? "any" : undefined}
        placeholder={placeholder}
        value={value}
        isDisabled={isDisabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </VStack>
  );
}
