import { BUILTIN_MODULE_LABEL } from "@shared/module-labels";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { Info } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ConfigurationForm, type FieldDescriptor } from "@/components/common/configuration-form";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { ModuleAssetFieldRenderer, withAssetModule } from "@/components/flow/module-asset-field";
import { StepIdField } from "@/components/flow/step-id-field";
import { Label } from "@/components/ui/label";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import type { CatalogActionRow } from "@/hooks/use-workflow-catalog";
import {
  appendToken,
  isWholeReference,
  settingProblem,
  variablesForSetting,
  variableUse,
  withSetting,
} from "@/lib/action-settings";
import { fieldOptionsOwnerFromCanonicalId, withFieldOptionsOwner } from "@/lib/field-options-reference";
import { parseConfigFields, parseDataShapeFields, withModuleName } from "@/lib/parse-config-fields";
import { cn } from "@/lib/utils";
import { resolveCatalogAction } from "@/lib/workflow-node-label";
import type { ActionNode } from "@/lib/workflow-tree";
import type { VariableOption } from "@/lib/workflow-variables";

export interface ActionSettingsEditorProps {
  step: ActionNode;
  catalogActions: CatalogActionRow[];
  existingStepIds: ReadonlySet<string>;
  /** Values of the trigger and of earlier steps this step can read. */
  availableVariables: VariableOption[];
  onChange: (step: ActionNode) => void;
  /** Renames the step; without it the step's id isn't offered for editing (the macro pad). */
  onRename?: (oldId: string, newId: string) => void;
}

/**
 * The step's own renderers on top of the shared ones: an `asset` lists its module's
 * files in place, where everywhere else it opens the streamer's asset library.
 */
const STEP_RENDERERS = { ...configFieldRenderers, "field:asset": ModuleAssetFieldRenderer };

/** How many earlier values a field lists before the rest are left to its own search. */
const SHOWN_VARIABLES = 8;

/**
 * An action step's settings, inside its row in the flow. Each setting is drawn by the
 * same renderer every other form uses (ConfigurationForm, one field at a time), and
 * this editor adds what a step needs around it: the module's help text in place, a
 * message while a setting is missing or out of bounds, and a way to take the value
 * from the trigger or an earlier step instead.
 */
export function ActionSettingsEditor({
  step,
  catalogActions,
  existingStepIds,
  availableVariables,
  onChange,
  onRename,
}: ActionSettingsEditorProps) {
  const row = resolveCatalogAction(step, catalogActions);
  const fields = useMemo(() => {
    if (!row) {
      return [];
    }
    const parsed = withModuleName(parseConfigFields(row.configFields), row.moduleName);
    return withAssetModule(
      withFieldOptionsOwner(parsed, fieldOptionsOwnerFromCanonicalId(row.canonicalRef)),
      row.moduleId
    );
  }, [row]);
  const outputs = useMemo(() => parseDataShapeFields(row?.returns), [row]);

  const setValue = (fieldId: string, value: unknown) =>
    onChange({ ...step, parameters: withSetting(step.parameters, fieldId, value) });

  return (
    <div className="flex flex-col gap-5" data-testid="action-settings">
      {row ? (
        <ActionIntro row={row} />
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="text-action-not-installed">
          The action this step runs isn't installed, so its settings can't be shown. The step is kept as it is.
        </p>
      )}
      {row && fields.length === 0 && <p className="text-sm text-muted-foreground">This action has no settings.</p>}
      {fields.map((field) => (
        <SettingRow
          key={field.id}
          field={field}
          values={step.parameters}
          variables={availableVariables}
          onChange={(value) => setValue(field.id, value)}
        />
      ))}
      {outputs.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="text-action-outputs">
          Later steps can use: {outputs.map((output) => output.path).join(", ")}.
        </p>
      )}
      {onRename && (
        <div className="border-t pt-4">
          <StepIdField id={step.id} existingStepIds={existingStepIds} onUpdateActionId={onRename} />
        </div>
      )}
    </div>
  );
}

function ActionIntro({ row }: { row: CatalogActionRow }) {
  const fromModule = row.moduleLabel && row.moduleLabel !== BUILTIN_MODULE_LABEL ? row.moduleLabel : undefined;
  if (!row.description && !fromModule) {
    return null;
  }
  return (
    <p className="text-[13px] text-muted-foreground">
      {row.description}
      {fromModule && <span className="block text-xs">From the {fromModule} module</span>}
    </p>
  );
}

/** The field as its renderer draws it: the help text is this editor's to show, in place. */
function withoutHelp(field: ConfigField): FieldDescriptor {
  return { ...field, description: undefined, hint: undefined, examplePayload: undefined } as FieldDescriptor;
}

function SettingRow({
  field,
  values,
  variables,
  onChange,
}: {
  field: ConfigField;
  values: Record<string, unknown>;
  variables: VariableOption[];
  onChange: (value: unknown) => void;
}) {
  const value = values[field.id];
  const use = variableUse(field);
  const offered = use === "none" ? [] : variablesForSetting(field, variables);
  // Held apart from the value: switching to an earlier value clears the fixed one, and an
  // empty value can't say the switch happened.
  const [chosenEarlier, setChosenEarlier] = useState(() => isWholeReference(value));
  const usingEarlier = use === "replace" && (chosenEarlier || isWholeReference(value));
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const problem = settingProblem(field, value);
  const hasHelp = Boolean(field.hint || field.examplePayload);
  const canSwitch = use === "replace" && (usingEarlier || offered.length > 0);

  const switchSource = () => {
    setChosenEarlier(!usingEarlier);
    onChange(undefined);
  };

  return (
    <div className="flex flex-col gap-2" data-testid={`setting-${field.id}`}>
      {usingEarlier ? (
        <EarlierValue field={field} value={value} offered={offered} onChange={onChange} />
      ) : (
        <ConfigurationForm
          fields={[withoutHelp(field)]}
          values={values}
          onChange={(next) => onChange(next[field.id])}
          customRenderers={STEP_RENDERERS}
          // Text takes earlier values inline; a layout's widgets take them in their own settings.
          availableVariables={use === "insert" || field.type === "layout" ? variables : []}
        />
      )}
      {use === "insert" && offered.length > 0 && (
        <InsertRow field={field} offered={offered} onInsert={(token) => onChange(appendToken(value, token))} />
      )}
      {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
      {problem && (
        <p
          className={cn(
            "text-xs",
            problem.kind === "missing" ? "text-amber-700 dark:text-amber-300" : "text-destructive"
          )}
          aria-live="polite"
          data-testid={`setting-problem-${field.id}`}
        >
          {problem.message}
        </p>
      )}
      {(canSwitch || hasHelp) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {canSwitch && (
            <button
              type="button"
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              onClick={switchSource}
              data-testid={`button-setting-source-${field.id}`}
            >
              {usingEarlier ? "Use a fixed value instead" : "Use a value from earlier"}
            </button>
          )}
          {hasHelp && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => setHelpOpen(!helpOpen)}
              data-testid={`button-setting-help-${field.id}`}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              {helpOpen ? "Hide help" : "More about this setting"}
            </button>
          )}
        </div>
      )}
      {hasHelp && helpOpen && (
        <div id={helpId} className="space-y-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {field.hint && <p>{field.hint}</p>}
          {field.examplePayload && (
            <div className="space-y-1">
              <p className="font-medium text-foreground">Example</p>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px] text-foreground">
                {field.examplePayload}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A setting whose whole value comes from earlier: pick one, or write the reference by hand. */
function EarlierValue({
  field,
  value,
  offered,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  offered: VariableOption[];
  onChange: (value: unknown) => void;
}) {
  const labelId = useId();
  const current = typeof value === "string" ? value : "";
  return (
    <div className="space-y-2">
      <Label id={labelId}>
        {field.label}
        {field.required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {offered.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing earlier in this workflow has a value that fits here.</p>
      ) : (
        <VariableChips
          labelledBy={labelId}
          offered={offered}
          isPressed={(option) => option.value === current.trim()}
          onPick={onChange}
        />
      )}
      <VariableAwareInput
        value={current}
        onChange={onChange}
        availableVariables={offered}
        placeholder="{value}"
        className="font-mono text-xs"
        data-testid={`input-variable-${field.id}`}
      />
    </div>
  );
}

/** Earlier values to write into a text setting, each added at the end of what is there. */
function InsertRow({
  field,
  offered,
  onInsert,
}: {
  field: ConfigField;
  offered: VariableOption[];
  onInsert: (token: string) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="text-xs text-muted-foreground">
        Insert a value from earlier
      </span>
      <VariableChips
        labelledBy={labelId}
        offered={offered}
        isPressed={() => false}
        onPick={onInsert}
        testIdPrefix={`chip-insert-${field.id}`}
      />
    </div>
  );
}

function VariableChips({
  labelledBy,
  offered,
  isPressed,
  onPick,
  testIdPrefix = "chip-variable",
}: {
  labelledBy: string;
  offered: VariableOption[];
  isPressed: (option: VariableOption) => boolean;
  onPick: (token: string) => void;
  testIdPrefix?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? offered : offered.slice(0, SHOWN_VARIABLES);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of choice chips, not a form field set.
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-1.5">
      {shown.map((option) => {
        const pressed = isPressed(option);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            title={option.description ? `${option.group}: ${option.description}` : option.group}
            onClick={() => onPick(option.value)}
            className={cn(
              "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pressed ? "border-primary/50 bg-primary/10 text-primary" : "bg-background hover:bg-muted"
            )}
            data-testid={`${testIdPrefix}-${option.value}`}
          >
            <span className="font-medium">{option.label}</span>
            <span className="text-muted-foreground">{option.group}</span>
          </button>
        );
      })}
      {offered.length > shown.length && (
        <button
          type="button"
          className="min-h-7 px-1.5 text-xs text-primary underline-offset-4 hover:underline"
          onClick={() => setShowAll(true)}
        >
          {offered.length - shown.length} more
        </button>
      )}
    </div>
  );
}
