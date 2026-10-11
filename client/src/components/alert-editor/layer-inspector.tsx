import type { ConfigField } from "@woofx3/api/ui-schema";
import { type CanvasSize, centerOf, type NodeView, type Point, type WidgetKind } from "@woofx3/scene/editor";
import { Minus, Plus } from "lucide-react";
import { ConfigurationForm, type FieldDescriptor } from "@/components/common/configuration-form";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import { durationOf } from "@/lib/alert-editor";
import { fieldOptionsOwnerFromCanonicalId, withFieldOptionsOwner } from "@/lib/field-options-reference";
import { withWidgetCanonicalId } from "@/lib/parse-config-fields";
import { cn } from "@/lib/utils";
import type { VariableOption } from "@/lib/workflow-variables";

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
const DEDICATED_SETTINGS: Record<WidgetKind, readonly string[]> = {
  text: ["text", "fontSize", "color", "duration"],
  image: ["src", "duration"],
  video: ["src", "duration"],
  audio: ["src", "duration"],
  lottie: ["src", "duration"],
  other: ["duration"],
};

interface LayerInspectorProps {
  /** The selected layer, as the composition editor shows it. */
  node: NodeView;
  /** The widget's settings schema, from the catalog. */
  fields: ConfigField[];
  canvas: CanvasSize;
  /** True when this layer alone sets the alert's length. */
  isLongest: boolean;
  availableVariables: VariableOption[];
  /** Merge settings into the layer's. A Text layer's box follows its text and size by itself. */
  onChangeSettings: (settings: Record<string, unknown>) => void;
  /** Set the layer's width about its centre; a layer that keeps its aspect takes its height from it. */
  onResize: (width: number) => void;
  /** Move the layer's centre, kept on the canvas. */
  onMoveCenter: (center: Point) => void;
}

/**
 * Edits the selected layer through the composition editor. Every change keeps the
 * layer's centre where it was; the rules for how a box follows (a Text box's height,
 * a media layer's aspect) are the widget's traits, applied by the editor.
 */
export function LayerInspector({
  node,
  fields,
  canvas,
  isLongest,
  availableVariables,
  onChangeSettings,
  onResize,
  onMoveCenter,
}: LayerInspectorProps) {
  const { kind, placement } = node;
  const center = centerOf(placement);
  const idPrefix = `layer-${node.id}`;

  const fontSize = typeof placement.settings.fontSize === "number" ? placement.settings.fontSize : 48;
  const text = typeof placement.settings.text === "string" ? placement.settings.text : "";
  const color = typeof placement.settings.color === "string" ? placement.settings.color : "#ffffff";
  const srcField = fields.find((field) => field.id === "src");
  const moreFields = fields.filter((field) => !DEDICATED_SETTINGS[kind].includes(field.id));

  return (
    <div className="flex flex-col gap-6">
      {kind === "text" && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-text`}>Text</Label>
            <VariableAwareInput
              id={`${idPrefix}-text`}
              multiline
              rows={3}
              value={text}
              onChange={(next) => onChangeSettings({ text: next })}
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
            onChange={(next) => onChangeSettings({ fontSize: next })}
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
                  onClick={() => onChangeSettings({ color: swatch.value })}
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
            value: placement.settings.src,
            onChange: (value) => onChangeSettings({ src: value }),
            availableVariables,
          })}
        </div>
      )}

      {kind !== "audio" && (
        <Stepper
          id={`${idPrefix}-width`}
          label="Width"
          value={placement.width}
          step={80}
          min={80}
          max={canvas.width}
          unit="px"
          onChange={onResize}
        />
      )}

      <fieldset className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <legend className="text-sm font-medium">Position</legend>
          <button
            type="button"
            className="text-xs text-primary-text hover:underline"
            onClick={() => onMoveCenter({ x: canvas.width / 2, y: canvas.height / 2 })}
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
                    onMoveCenter({ ...center, [axis]: next });
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
          value={durationOf(placement)}
          step={0.5}
          min={0}
          max={60}
          unit="s"
          onChange={(duration) => onChangeSettings({ duration })}
        />
        <p className="text-xs text-muted-foreground">
          {durationOf(placement) === 0
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
              fields={
                withFieldOptionsOwner(
                  withWidgetCanonicalId(moreFields, placement.widget),
                  fieldOptionsOwnerFromCanonicalId(placement.widget)
                ) as unknown as FieldDescriptor[]
              }
              values={placement.settings}
              onChange={(next) => onChangeSettings(next)}
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
