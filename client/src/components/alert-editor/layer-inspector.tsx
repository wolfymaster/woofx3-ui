import type { ConfigField } from "@woofx3/api/ui-schema";
import type { NodeView } from "@woofx3/scene/editor";
import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { WidgetSettingsForm } from "@/components/scenes/widget-settings-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import { type LayerWindow, layerWindowLabel } from "@/lib/behavior-editor";
import type { VariableOption } from "@/lib/workflow-variables";

interface LayerInspectorProps {
  /** The selected layer, as the composition editor shows it. */
  node: NodeView;
  /** The widget's settings schema, from the catalog. */
  fields: ConfigField[];
  availableVariables: VariableOption[];
  /** Merge settings into the layer's. A Text layer's box follows its text and size by itself. */
  onChangeSettings: (settings: Record<string, unknown>) => void;
  /** When the layer plays within the alert. */
  window: LayerWindow;
  onChangeWindow: (window: LayerWindow) => void;
  /** Shown below the layer's settings: its transitions and effects. */
  children?: ReactNode;
}

/**
 * Edits the selected layer through the composition editor: the widget's own settings,
 * drawn from its schema exactly as the scene editor draws them, then when the layer
 * plays within the alert. Size and place are set on the stage, as on a scene's canvas.
 */
export function LayerInspector({
  node,
  fields,
  availableVariables,
  onChangeSettings,
  window,
  onChangeWindow,
  children,
}: LayerInspectorProps) {
  return (
    <div className="flex flex-col gap-6">
      <WidgetSettingsForm
        widgetCanonicalId={node.placement.widget}
        settings={node.placement.settings}
        fields={fields}
        renderers={configFieldRenderers}
        availableVariables={availableVariables}
        onChangeSetting={(key, value) => onChangeSettings({ [key]: value })}
      />
      <LayerWindowFields idPrefix={`layer-${node.id}`} window={window} onChange={onChangeWindow} />
      {children}
    </div>
  );
}

/** Longest a layer's start or stay may be set to here, in seconds: an alert is cut off at five minutes. */
const MAX_WINDOW_SECONDS = 300;
const STAYS_UNTIL_COMPLETE = "complete";
const STAYS_FOR = "for";

/** When the layer enters after the alert starts, and whether it stays until it completes or for a set time. */
function LayerWindowFields({
  idPrefix,
  window,
  onChange,
}: {
  idPrefix: string;
  window: LayerWindow;
  onChange: (window: LayerWindow) => void;
}) {
  const toMs = (seconds: number) => Math.round(seconds * 1000);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">Timing</legend>
      <Stepper
        id={`${idPrefix}-starts-after`}
        label="Starts after"
        value={window.startMs / 1000}
        step={0.5}
        min={0}
        max={MAX_WINDOW_SECONDS}
        unit="s"
        onChange={(seconds) => onChange({ ...window, startMs: toMs(seconds) })}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-stays`}>Stays</Label>
        <Select
          value={window.stayMs === null ? STAYS_UNTIL_COMPLETE : STAYS_FOR}
          onValueChange={(next) =>
            onChange({ ...window, stayMs: next === STAYS_UNTIL_COMPLETE ? null : (window.stayMs ?? 5_000) })
          }
        >
          <SelectTrigger id={`${idPrefix}-stays`} className="h-11 lg:h-9" data-testid={`select-${idPrefix}-stays`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STAYS_UNTIL_COMPLETE}>Until it completes</SelectItem>
            <SelectItem value={STAYS_FOR}>For a set time</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {window.stayMs !== null && (
        <Stepper
          id={`${idPrefix}-stays-for`}
          label="Stays for"
          value={window.stayMs / 1000}
          step={0.5}
          min={0.5}
          max={MAX_WINDOW_SECONDS}
          unit="s"
          onChange={(seconds) => onChange({ ...window, stayMs: toMs(seconds) })}
        />
      )}
      <p className="text-xs text-muted-foreground">{layerWindowLabel(window)}.</p>
    </fieldset>
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
