import type { CatalogWidget, CommandResult, CompositionEditor } from "@woofx3/scene/editor";
import {
  type AnchorKind,
  type BehaviorDocument,
  type BehaviorId,
  EASINGS,
  type NodeId,
  type Timing,
  TRANSITION_DIRECTIONS,
  type TransitionDirection,
  type TransitionPhase,
} from "@woofx3/scene/model";
import { ArrowDown, ArrowUp, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ANCHOR_LABELS,
  type BehaviorEntry,
  behaviorsOf,
  DIRECTION_LABELS,
  defaultTransitionEasing,
  type EffectParamField,
  effectAnchors,
  effectParamFields,
  effectTimingLabel,
  formatMs,
  type KindOption,
  kindOptions,
  NO_TRANSITION,
  paramValue,
  previewAnimation,
  timingMsOf,
  transitionDurationOf,
  transitionOf,
  transitionParamsFor,
  withParam,
} from "@/lib/behavior-editor";

const PHASES: Array<{ phase: TransitionPhase; label: string; hint: string }> = [
  { phase: "in", label: "Enter", hint: "When the widget is shown, or its alert starts." },
  { phase: "out", label: "Exit", hint: "Played in full before the widget is hidden." },
];

const UNTIL_EXIT = "until-exit";
const FOR_A_TIME = "for";
/** What a newly timed effect lasts when "For a set time" is picked. */
const DEFAULT_EFFECT_MS = 2_000;

interface WidgetBehaviorsSectionProps {
  editor: CompositionEditor;
  behaviors: Readonly<Record<BehaviorId, BehaviorDocument>>;
  nodeId: NodeId;
  /** The widget's catalog row, for the kinds it declares; undefined when it is no longer installed. */
  row: CatalogWidget | undefined;
  /** The anchors timing may use here (`capabilities.anchors`): an effect may start with an alert only on one. */
  anchors: readonly AnchorKind[];
  disabled?: boolean;
  /** Told when the editor refused a change made here, with its reason. */
  onRefused: (result: CommandResult) => void;
}

/**
 * How the selected widget enters and leaves, and the effects it plays while
 * shown. Every change goes to the composition editor's behaviors, which
 * refuses one the registry would not store.
 */
export function WidgetBehaviorsSection({
  editor,
  behaviors,
  nodeId,
  row,
  anchors,
  disabled = false,
  onRefused,
}: WidgetBehaviorsSectionProps) {
  const report = (result: CommandResult) => {
    if (!result.ok) {
      onRefused(result);
    }
  };
  const effects = behaviorsOf(behaviors, nodeId, "effect");

  return (
    <>
      <section className="mt-6 space-y-4 border-t pt-4" data-testid="widget-transitions">
        <h3 className="text-sm font-semibold">Transitions</h3>
        {PHASES.map(({ phase, label, hint }) => (
          <TransitionPicker
            key={phase}
            id={`${nodeId}-transition-${phase}`}
            label={label}
            hint={hint}
            phase={phase}
            entry={transitionOf(behaviors, nodeId, phase)}
            row={row}
            disabled={disabled}
            onPick={(kind, entry) => {
              if (kind === NO_TRANSITION) {
                if (entry !== null) {
                  report(editor.behaviors.remove(entry.id));
                }
                return;
              }
              const params = transitionParamsFor(kind, phase, entry?.behavior);
              if (entry === null) {
                report(editor.behaviors.add(nodeId, "transition", kind, {}, params));
                return;
              }
              report(editor.behaviors.patch(entry.id, { kind, params }));
            }}
            onPatch={(id, patch) => report(editor.behaviors.patch(id, patch))}
          />
        ))}
      </section>

      <section className="mt-6 space-y-4 border-t pt-4" data-testid="widget-effects">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Effects</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            disabled={disabled}
            onClick={() => report(editor.behaviors.add(nodeId, "effect", "pulse"))}
            data-testid="button-add-effect"
          >
            <Plus />
            Add effect
          </Button>
        </div>
        {effects.length === 0 ? (
          <p className="text-xs text-muted-foreground">Effects play on the widget while it is shown.</p>
        ) : (
          effects.map((entry, index) => (
            <EffectCard
              key={entry.id}
              entry={entry}
              row={row}
              allowedAnchors={anchors}
              disabled={disabled}
              isFirst={index === 0}
              isLast={index === effects.length - 1}
              onPatch={(patch) => report(editor.behaviors.patch(entry.id, patch))}
              onMove={(to) =>
                report(editor.behaviors.reorder(entry.id, { index: to === "up" ? index - 1 : index + 1 }))
              }
              onRemove={() => report(editor.behaviors.remove(entry.id))}
            />
          ))
        )}
      </section>
    </>
  );
}

type BehaviorPatch = Parameters<CompositionEditor["behaviors"]["patch"]>[1];

interface TransitionPickerProps {
  id: string;
  label: string;
  hint: string;
  phase: TransitionPhase;
  entry: BehaviorEntry | null;
  row: CatalogWidget | undefined;
  disabled: boolean;
  onPick: (kind: string, entry: BehaviorEntry | null) => void;
  onPatch: (id: BehaviorId, patch: BehaviorPatch) => void;
}

function TransitionPicker({ id, label, hint, phase, entry, row, disabled, onPick, onPatch }: TransitionPickerProps) {
  const behavior = entry?.behavior ?? null;
  const options = kindOptions(row, "transition", behavior?.kind);
  const value = behavior?.kind ?? NO_TRANSITION;
  const durationMs = typeof behavior?.timing.durationMs === "number" ? behavior.timing.durationMs : 0;
  const patchTiming = (timing: Partial<Timing>) => {
    if (entry !== null) {
      onPatch(entry.id, { timing: { ...entry.behavior.timing, ...timing } });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${id}-type`}>{label}</Label>
        {behavior && <PreviewSwatch behavior={behavior} />}
      </div>
      <Select value={value} disabled={disabled} onValueChange={(next) => onPick(next, entry)}>
        <SelectTrigger id={`${id}-type`} data-testid={`select-${id}-type`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TRANSITION}>None</SelectItem>
          <SelectSeparator />
          <KindGroups options={options} />
        </SelectContent>
      </Select>
      {entry !== null && behavior !== null && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-duration`} className="text-xs text-muted-foreground">
              Duration (ms)
            </Label>
            <CommitInput
              id={`${id}-duration`}
              value={String(durationMs)}
              step={50}
              disabled={disabled}
              onCommit={(text) => {
                const ms = transitionDurationOf(text);
                if (ms === null) {
                  return false;
                }
                patchTiming({ durationMs: ms });
                return true;
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-easing`} className="text-xs text-muted-foreground">
              Easing
            </Label>
            <Select
              value={behavior.timing.easing}
              disabled={disabled}
              onValueChange={(next) => patchTiming({ easing: next as Timing["easing"] })}
            >
              <SelectTrigger id={`${id}-easing`} data-testid={`select-${id}-easing`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EASINGS.map((easing) => (
                  <SelectItem key={easing} value={easing}>
                    {easing === defaultTransitionEasing(phase) ? `${easing} (default)` : easing}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {behavior.kind === "slide" && (
            <div className="col-span-2 space-y-1">
              <Label htmlFor={`${id}-direction`} className="text-xs text-muted-foreground">
                Direction
              </Label>
              <Select
                value={typeof behavior.params.direction === "string" ? behavior.params.direction : "up"}
                disabled={disabled}
                onValueChange={(next) =>
                  onPatch(entry.id, { params: { ...behavior.params, direction: next as TransitionDirection } })
                }
              >
                <SelectTrigger id={`${id}-direction`} data-testid={`select-${id}-direction`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSITION_DIRECTIONS.map((direction) => (
                    <SelectItem key={direction} value={direction}>
                      {DIRECTION_LABELS[direction]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** The kinds a picker offers, grouped by who plays them. */
function KindGroups({ options }: { options: KindOption[] }) {
  const groups: Array<{ group: KindOption["group"]; label: string }> = [
    { group: "host", label: "Any widget" },
    { group: "widget", label: "This widget" },
    { group: "unavailable", label: "Not available here" },
  ];
  return (
    <>
      {groups.map(({ group, label }) => {
        const inGroup = options.filter((option) => option.group === group);
        if (inGroup.length === 0) {
          return null;
        }
        return (
          <SelectGroup key={group}>
            <SelectLabel>{label}</SelectLabel>
            {inGroup.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        );
      })}
    </>
  );
}

interface EffectCardProps {
  entry: BehaviorEntry;
  row: CatalogWidget | undefined;
  allowedAnchors: readonly AnchorKind[];
  disabled: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPatch: (patch: BehaviorPatch) => void;
  onMove: (to: "up" | "down") => void;
  onRemove: () => void;
}

function EffectCard({
  entry,
  row,
  allowedAnchors,
  disabled,
  isFirst,
  isLast,
  onPatch,
  onMove,
  onRemove,
}: EffectCardProps) {
  const { id, behavior } = entry;
  const idPrefix = `effect-${id}`;
  const fields = effectParamFields(behavior.kind);
  const anchors = effectAnchors(allowedAnchors);
  const { timing } = behavior;
  const patchTiming = (next: Partial<Timing>) => onPatch({ timing: { ...timing, ...next } });

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid={`effect-${id}`}>
      <div className="flex items-center gap-1">
        <Select
          value={behavior.kind}
          disabled={disabled}
          // A new kind starts from the overlay's defaults: another kind's params mean nothing to it.
          onValueChange={(kind) => onPatch({ kind, params: {} })}
        >
          <SelectTrigger className="h-8 flex-1" aria-label="Effect" data-testid={`select-${idPrefix}-kind`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <KindGroups options={kindOptions(row, "effect", behavior.kind)} />
          </SelectContent>
        </Select>
        <PreviewSwatch behavior={behavior} compact />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          disabled={disabled || isFirst}
          onClick={() => onMove("up")}
          aria-label="Move effect up"
        >
          <ArrowUp />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          disabled={disabled || isLast}
          onClick={() => onMove("down")}
          aria-label="Move effect down"
        >
          <ArrowDown />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Remove effect"
          data-testid={`button-remove-${idPrefix}`}
        >
          <Trash2 />
        </Button>
      </div>

      {fields.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {fields.map((field) => (
            <EffectParamInput
              key={field.name}
              id={`${idPrefix}-${field.name}`}
              field={field}
              params={behavior.params}
              disabled={disabled}
              onChange={(params) => onPatch({ params })}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {anchors.length > 1 && (
          <div className="col-span-2 space-y-1">
            <Label htmlFor={`${idPrefix}-anchor`} className="text-xs text-muted-foreground">
              Starts
            </Label>
            <Select
              value={timing.anchor}
              disabled={disabled}
              onValueChange={(anchor) => patchTiming({ anchor: anchor as Timing["anchor"] })}
            >
              <SelectTrigger id={`${idPrefix}-anchor`} className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anchors.map((anchor) => (
                  <SelectItem key={anchor} value={anchor}>
                    {ANCHOR_LABELS[anchor] ?? anchor}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-offset`} className="text-xs text-muted-foreground">
            Delay (s)
          </Label>
          <CommitInput
            id={`${idPrefix}-offset`}
            value={String(timing.offsetMs / 1000)}
            step={0.1}
            disabled={disabled}
            onCommit={(text) => {
              const ms = timingMsOf(text);
              if (ms === null) {
                return false;
              }
              patchTiming({ offsetMs: ms });
              return true;
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-lasts`} className="text-xs text-muted-foreground">
            Lasts
          </Label>
          <Select
            value={timing.durationMs === UNTIL_EXIT ? UNTIL_EXIT : FOR_A_TIME}
            disabled={disabled}
            onValueChange={(next) => patchTiming({ durationMs: next === UNTIL_EXIT ? UNTIL_EXIT : DEFAULT_EFFECT_MS })}
          >
            <SelectTrigger id={`${idPrefix}-lasts`} className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNTIL_EXIT}>Until it leaves</SelectItem>
              <SelectItem value={FOR_A_TIME}>For a set time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {timing.durationMs !== UNTIL_EXIT && (
          <div className="col-span-2 space-y-1">
            <Label htmlFor={`${idPrefix}-length`} className="text-xs text-muted-foreground">
              Length (s)
            </Label>
            <CommitInput
              id={`${idPrefix}-length`}
              value={String(timing.durationMs / 1000)}
              step={0.1}
              disabled={disabled}
              onCommit={(text) => {
                // An effect lasts some time: zero is refused by the registry.
                const ms = timingMsOf(text, { min: 1 });
                if (ms === null) {
                  return false;
                }
                patchTiming({ durationMs: ms });
                return true;
              }}
            />
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{effectTimingLabel(timing)}</p>
    </div>
  );
}

function EffectParamInput({
  id,
  field,
  params,
  disabled,
  onChange,
}: {
  id: string;
  field: EffectParamField;
  params: Record<string, unknown>;
  disabled: boolean;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const value = paramValue(params, field);
  const label = field.unit === undefined ? field.label : `${field.label} (${field.unit})`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {field.input === "color" ? (
        <Input
          id={id}
          type="color"
          className="h-9 p-1"
          value={String(value)}
          disabled={disabled}
          onChange={(event) => {
            const next = withParam(params, field, event.target.value);
            if (next !== null) {
              onChange(next);
            }
          }}
          data-testid={`input-${id}`}
        />
      ) : (
        <CommitInput
          id={id}
          value={String(value)}
          step={field.step}
          disabled={disabled}
          onCommit={(text) => {
            const next = withParam(params, field, text);
            if (next === null) {
              return false;
            }
            onChange(next);
            return true;
          }}
        />
      )}
    </div>
  );
}

/**
 * A number field that reports its value only once typing is done, so a
 * half-typed value is never clamped. `onCommit` returns false for text it
 * could not use, and the field goes back to its value.
 */
function CommitInput({
  id,
  value,
  step,
  disabled,
  onCommit,
}: {
  id: string;
  value: string;
  step: number;
  disabled: boolean;
  onCommit: (text: string) => boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  const commit = () => {
    if (text === value) {
      return;
    }
    if (!onCommit(text)) {
      setText(value);
    }
  };
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      value={text}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        }
      }}
      data-testid={`input-${id}`}
    />
  );
}

/**
 * Plays a host behavior on a stand-in box with the overlay's own keyframes
 * (`compileAnimation`). A kind the widget plays itself animates the widget's
 * content, which only the overlay can show.
 */
function PreviewSwatch({ behavior, compact = false }: { behavior: BehaviorDocument; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const animation = previewAnimation(behavior);
  const play = () => {
    const element = box.current;
    if (!element || animation === null) {
      return;
    }
    for (const running of element.getAnimations()) {
      running.cancel();
    }
    element.animate(animation.keyframes, animation.options);
  };
  const title =
    animation === null
      ? "This widget plays it in the overlay"
      : behavior.type === "effect"
        ? `Preview (${formatMs(Number(animation.options.duration) * Number(animation.options.iterations))})`
        : "Preview";
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-6 w-10 items-center justify-center overflow-hidden rounded-sm border bg-muted/40">
        <div ref={box} className="h-3 w-5 rounded-[2px] bg-primary" />
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={compact ? "h-8 w-8 px-0" : "h-6 min-h-6 px-2"}
        onClick={play}
        disabled={animation === null}
        title={title}
        aria-label={title}
        data-testid="button-preview-behavior"
      >
        <Play />
        {!compact && "Preview"}
      </Button>
    </div>
  );
}
