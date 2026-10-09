import {
  type PlacementTransition,
  TRANSITION_DIRECTIONS,
  TRANSITION_EASINGS,
  type TransitionDirection,
  type TransitionEasing,
  type WidgetTransitionOption,
} from "@convex/lib/widgetTransitions";
import { Play } from "lucide-react";
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
  defaultEasing,
  pickerValue,
  previewKeyframes,
  type TransitionPhase,
  transitionTypeOptions,
  withTransitionDirection,
  withTransitionDuration,
  withTransitionEasing,
  withTransitionType,
} from "@/lib/widget-transition-editor";
import type { Widget } from "@/types";

const DEFAULT_EASING = "default";

const DIRECTION_LABELS: Record<TransitionDirection, string> = { up: "Up", down: "Down", left: "Left", right: "Right" };

const PHASES: Array<{ phase: TransitionPhase; field: "transitionIn" | "transitionOut"; label: string; hint: string }> =
  [
    { phase: "in", field: "transitionIn", label: "Enter", hint: "When the widget is shown, or its alert starts." },
    { phase: "out", field: "transitionOut", label: "Exit", hint: "Played in full before the widget is hidden." },
  ];

interface WidgetTransitionsSectionProps {
  widget: Widget;
  /** The transition types this widget declares for its own content. */
  declared: WidgetTransitionOption[];
  onChange: (field: "transitionIn" | "transitionOut", transition: PlacementTransition | undefined) => void;
}

/** How the selected widget enters and leaves: a type, duration and easing for each. */
export function WidgetTransitionsSection({ widget, declared, onChange }: WidgetTransitionsSectionProps) {
  return (
    <section className="mt-6 space-y-4 border-t pt-4" data-testid="widget-transitions">
      <h3 className="text-sm font-semibold">Transitions</h3>
      {PHASES.map(({ phase, field, label, hint }) => (
        <TransitionPicker
          key={field}
          id={`${widget.id}-${field}`}
          label={label}
          hint={hint}
          phase={phase}
          transition={widget[field]}
          declared={declared}
          onChange={(next) => onChange(field, next)}
        />
      ))}
    </section>
  );
}

interface TransitionPickerProps {
  id: string;
  label: string;
  hint: string;
  phase: TransitionPhase;
  transition: PlacementTransition | undefined;
  declared: WidgetTransitionOption[];
  onChange: (transition: PlacementTransition | undefined) => void;
}

function TransitionPicker({ id, label, hint, phase, transition, declared, onChange }: TransitionPickerProps) {
  const options = transitionTypeOptions(declared);
  const value = pickerValue(transition, declared);
  const active = value === "none" ? undefined : transition;
  const generic = options.filter((o) => o.group === "generic");
  const own = options.filter((o) => o.group === "widget");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${id}-type`}>{label}</Label>
        {active && <TransitionPreview transition={active} phase={phase} />}
      </div>
      <Select value={value} onValueChange={(next) => onChange(withTransitionType(active, next))}>
        <SelectTrigger id={`${id}-type`} data-testid={`select-${id}-type`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Any widget</SelectLabel>
            {generic.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
          {own.length > 0 && (
            <SelectGroup>
              <SelectLabel>This widget</SelectLabel>
              {own.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      {active && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-duration`} className="text-xs text-muted-foreground">
              Duration (ms)
            </Label>
            <DurationInput
              id={`${id}-duration`}
              durationMs={active.durationMs}
              onCommit={(ms) => onChange(withTransitionDuration(active, ms))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-easing`} className="text-xs text-muted-foreground">
              Easing
            </Label>
            <Select
              value={active.easing ?? DEFAULT_EASING}
              onValueChange={(next) =>
                onChange(withTransitionEasing(active, next === DEFAULT_EASING ? undefined : (next as TransitionEasing)))
              }
            >
              <SelectTrigger id={`${id}-easing`} data-testid={`select-${id}-easing`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_EASING}>Default ({defaultEasing(phase)})</SelectItem>
                {TRANSITION_EASINGS.map((easing) => (
                  <SelectItem key={easing} value={easing}>
                    {easing}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {active.type === "slide" && (
            <div className="col-span-2 space-y-1">
              <Label htmlFor={`${id}-direction`} className="text-xs text-muted-foreground">
                Direction
              </Label>
              <Select
                value={active.direction ?? "up"}
                onValueChange={(next) => onChange(withTransitionDirection(active, next as TransitionDirection))}
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

/** A number field that only reports a duration once typing is done, so a half-typed value is never clamped. */
function DurationInput({
  id,
  durationMs,
  onCommit,
}: {
  id: string;
  durationMs: number;
  onCommit: (durationMs: number) => void;
}) {
  const [text, setText] = useState(String(durationMs));
  useEffect(() => {
    setText(String(durationMs));
  }, [durationMs]);
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) {
      setText(String(durationMs));
      return;
    }
    onCommit(parsed);
  };
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      step={50}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
        }
      }}
      data-testid={`input-${id}`}
    />
  );
}

/**
 * Plays a generic transition on a stand-in box, with the overlay's own
 * keyframes. A type the widget plays itself animates the widget's content,
 * which only the overlay can show.
 */
function TransitionPreview({ transition, phase }: { transition: PlacementTransition; phase: TransitionPhase }) {
  const box = useRef<HTMLDivElement>(null);
  const keyframes = previewKeyframes(transition, phase);
  const play = () => {
    const element = box.current;
    if (!element || !keyframes) {
      return;
    }
    for (const running of element.getAnimations()) {
      running.cancel();
    }
    element.animate(keyframes, {
      duration: transition.durationMs,
      easing: transition.easing ?? defaultEasing(phase),
    });
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-6 w-10 items-center justify-center overflow-hidden rounded-sm border bg-muted/40">
        <div ref={box} className="h-3 w-5 rounded-[2px] bg-primary" />
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 min-h-6 px-2"
        onClick={play}
        disabled={!keyframes}
        title={keyframes ? "Preview" : "This widget plays it in the overlay"}
        data-testid="button-preview-transition"
      >
        <Play />
        Preview
      </Button>
    </div>
  );
}
