import type { ConfigField } from "@woofx3/api/ui-schema";
import { Minus, Plus, Trash2 } from "lucide-react";
import { ConfigurationForm, type FieldDescriptor } from "@/components/common/configuration-form";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import {
  type CanvasSize,
  centerOf,
  clampCenter,
  durationOf,
  type LayerKind,
  layerKind,
  MEDIA_ASPECT,
  textBoxHeight,
  withCenter,
} from "@/lib/alert-editor";
import { cn } from "@/lib/utils";
import type { VariableOption } from "@/lib/workflow-variables";
import type { Widget } from "@/types";

/** The swatches offered for text. A color set some other way shows beside them, selected. */
const TEXT_COLORS = [
  { label: "White", value: "#ffffff" },
  { label: "Lavender", value: "#c9b8ff" },
  { label: "Amber", value: "#f0b86e" },
  { label: "Mint", value: "#7ee2a8" },
  { label: "Pink", value: "#ff8fa3" },
] as const;

/**
 * Settings each bundled widget's inspector shows as dedicated controls; the rest of its
 * schema follows under More settings. A widget from a module gets its whole schema.
 */
const DEDICATED_SETTINGS: Record<LayerKind, readonly string[]> = {
  text: ["text", "fontSize", "color", "duration"],
  image: ["src", "duration"],
  video: ["src", "duration"],
  audio: ["src", "duration"],
  lottie: ["src", "duration"],
  other: ["duration"],
};

interface LayerInspectorProps {
  widget: Widget;
  /** The widget's settings schema, from the catalog. */
  fields: ConfigField[];
  canvas: CanvasSize;
  /** True when this layer alone sets the alert's length. */
  isLongest: boolean;
  availableVariables: VariableOption[];
  onChange: (widget: Widget) => void;
  onDelete: () => void;
}

/** Edits the selected layer. Every change keeps the layer's center where it was. */
export function LayerInspector({
  widget,
  fields,
  canvas,
  isLongest,
  availableVariables,
  onChange,
  onDelete,
}: LayerInspectorProps) {
  const kind = layerKind(widget);
  const center = centerOf(widget);
  const idPrefix = `layer-${widget.id}`;

  const setSettings = (settings: Record<string, unknown>) => {
    onChange({ ...widget, settings: { ...widget.settings, ...settings } });
  };
  const resize = (size: Widget["size"]) => {
    onChange(withCenter({ ...widget, size }, center));
  };

  const fontSize = typeof widget.settings.fontSize === "number" ? widget.settings.fontSize : 48;
  const text = typeof widget.settings.text === "string" ? widget.settings.text : "";
  const color = typeof widget.settings.color === "string" ? widget.settings.color : "#ffffff";
  const srcField = fields.find((field) => field.id === "src");
  const moreFields = fields.filter((field) => !DEDICATED_SETTINGS[kind].includes(field.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{widget.name}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 text-muted-foreground hover:bg-destructive/10 hover:text-destructive lg:h-8 lg:w-8"
          onClick={onDelete}
          aria-label="Delete layer"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {kind === "text" && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-text`}>Text</Label>
            <VariableAwareInput
              id={`${idPrefix}-text`}
              multiline
              rows={3}
              value={text}
              onChange={(next) =>
                onChange(
                  withCenter(
                    {
                      ...widget,
                      settings: { ...widget.settings, text: next },
                      size: { ...widget.size, height: textBoxHeight(fontSize, next) },
                    },
                    center
                  )
                )
              }
              availableVariables={availableVariables}
              className="text-base lg:text-sm"
            />
          </div>
          <Stepper
            id={`${idPrefix}-size`}
            label="Size"
            value={fontSize}
            step={4}
            min={12}
            max={240}
            unit="px"
            onChange={(next) =>
              onChange(
                withCenter(
                  {
                    ...widget,
                    settings: { ...widget.settings, fontSize: next },
                    size: { ...widget.size, height: textBoxHeight(next, text) },
                  },
                  center
                )
              )
            }
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Color</legend>
            <div className="flex flex-wrap gap-1">
              {TEXT_COLORS.map((swatch) => (
                <Swatch
                  key={swatch.value}
                  label={swatch.label}
                  color={swatch.value}
                  isPressed={color.toLowerCase() === swatch.value}
                  onClick={() => setSettings({ color: swatch.value })}
                />
              ))}
              {!TEXT_COLORS.some((swatch) => swatch.value === color.toLowerCase()) && (
                <Swatch label={`Custom ${color}`} color={color} isPressed onClick={() => undefined} />
              )}
            </div>
          </fieldset>
        </>
      )}

      {kind !== "text" && kind !== "other" && srcField && (
        <div>
          {configFieldRenderers.media({
            field: srcField as unknown as FieldDescriptor,
            value: widget.settings.src,
            onChange: (value) => setSettings({ src: value }),
            availableVariables,
          })}
        </div>
      )}

      {kind !== "audio" && (
        <Stepper
          id={`${idPrefix}-width`}
          label="Width"
          value={widget.size.width}
          step={80}
          min={80}
          max={canvas.width}
          unit="px"
          onChange={(width) =>
            resize(
              kind === "text" || kind === "other"
                ? { ...widget.size, width }
                : { width, height: Math.round(width * MEDIA_ASPECT) }
            )
          }
        />
      )}

      <fieldset className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <legend className="text-sm font-medium">Position</legend>
          <button
            type="button"
            className="text-xs text-primary-text hover:underline"
            onClick={() => onChange(withCenter(widget, { x: canvas.width / 2, y: canvas.height / 2 }))}
          >
            Center
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y"] as const).map((axis) => (
            <div key={axis} className="flex items-center gap-2">
              <Label htmlFor={`${idPrefix}-${axis}`} className="w-3 font-mono text-xs uppercase text-muted-foreground">
                {axis}
              </Label>
              <Input
                id={`${idPrefix}-${axis}`}
                type="number"
                inputMode="numeric"
                value={Math.round(center[axis])}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) {
                    onChange(withCenter(widget, clampCenter({ ...center, [axis]: next }, canvas)));
                  }
                }}
                className="h-11 font-mono text-base lg:h-9 lg:text-sm"
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Stepper
          id={`${idPrefix}-duration`}
          label="Duration"
          value={durationOf(widget)}
          step={0.5}
          min={0}
          max={60}
          unit="s"
          onChange={(duration) => setSettings({ duration })}
        />
        <p className="text-xs text-muted-foreground">
          {durationOf(widget) === 0
            ? kind === "video" || kind === "audio" || kind === "lottie"
              ? "0 plays the file through once."
              : "0 keeps it up for as long as the alert plays."
            : isLongest
              ? "Longest layer, so it sets the alert length."
              : null}
        </p>
      </div>

      {moreFields.length > 0 && (
        <details className="group" open={kind === "other"}>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">More settings</summary>
          <div className="pt-4">
            <ConfigurationForm
              fields={moreFields as unknown as FieldDescriptor[]}
              values={widget.settings}
              onChange={(next) => setSettings(next)}
              customRenderers={configFieldRenderers}
              availableVariables={availableVariables}
            />
          </div>
        </details>
      )}
    </div>
  );
}

interface StepperProps {
  id: string;
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}

function Stepper({ id, label, value, step, min, max, unit, onChange }: StepperProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next / step) * step));
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 lg:h-9 lg:w-9"
          onClick={() => onChange(clamp(value - step))}
          disabled={value <= min}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <div className="relative flex-1">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            value={value}
            step={step}
            min={min}
            max={max}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                onChange(Math.min(max, Math.max(min, next)));
              }
            }}
            className="h-11 pr-8 text-center font-mono text-base lg:h-9 lg:text-sm"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {unit}
          </span>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 lg:h-9 lg:w-9"
          onClick={() => onChange(clamp(value + step))}
          disabled={value >= max}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Swatch({
  label,
  color,
  isPressed,
  onClick,
}: {
  label: string;
  color: string;
  isPressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isPressed}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full lg:h-9 lg:w-9"
    >
      <span
        className={cn(
          "h-7 w-7 rounded-full border border-white/20",
          isPressed && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
        style={{ backgroundColor: color }}
      />
    </button>
  );
}
