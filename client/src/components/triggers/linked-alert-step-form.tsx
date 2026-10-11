import { api } from "@convex/_generated/api";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { Link } from "wouter";
import { LibraryAlertPreview } from "@/components/alert-editor/alert-library-dialog";
import { AlertLayoutPreview } from "@/components/alerts/alert-layout-preview";
import { Button } from "@/components/ui/button";
import { TriggerConfigForm } from "@/components/workflows/trigger-config-form";
import { useInstance } from "@/hooks/use-instance";
import { inputFieldsOf, inputVariableWarnings, libraryAlertInputs, linkedInputValues } from "@/lib/alert-library";
import type { TriggerConfigValues } from "@/lib/workflow-presets";
import type { VariableOption } from "@/lib/workflow-variables";

interface LinkedAlertStepFormProps {
  /** The library alert the step links. */
  compositionId: string;
  /** The alert action's own fields; its `layout` gives way to the library alert. */
  fields: ConfigField[];
  values: TriggerConfigValues;
  onChange: (values: TriggerConfigValues) => void;
  availableVariables: VariableOption[];
  /** Where "Edit alert" goes: the step's alert editor, which opens the library alert. */
  alertEditorHref: string;
}

/**
 * An alert step that plays a library alert: the step's own settings (the alert widget to
 * play on), the library alert it links, and a form for the inputs that alert declares.
 * The inputs take variables like any step setting (`${trigger.data...}`), resolved by the
 * workflow before the alert plays; an input that refers to a variable the step's
 * trigger and earlier steps do not provide is flagged, since it would play empty.
 */
export function LinkedAlertStepForm({
  compositionId,
  fields,
  values,
  onChange,
  availableVariables,
  alertEditorHref,
}: LinkedAlertStepFormProps) {
  const { instance } = useInstance();
  const alert = useQuery(
    api.alertCompositions.getByEngineId,
    instance ? { instanceId: instance._id, engineCompositionId: compositionId } : "skip"
  );
  const ownFields = useMemo(() => fields.filter((field) => field.type !== "layout"), [fields]);
  const inputFields = useMemo(() => (alert ? inputFieldsOf(libraryAlertInputs(alert)) : []), [alert]);
  const inputValues = linkedInputValues(values);
  const warnings = inputVariableWarnings(inputFields, inputValues, availableVariables);

  return (
    <div className="space-y-4">
      {ownFields.length > 0 && (
        <TriggerConfigForm
          fields={ownFields}
          values={values}
          onChange={onChange}
          availableVariables={availableVariables}
        />
      )}
      <div className="flex flex-col gap-4 rounded-[10px] border bg-background/60 p-2.5 sm:flex-row sm:items-center">
        {alert ? (
          <LibraryAlertPreview alert={alert} className="h-[132px] shrink-0 sm:h-[63px] sm:w-[112px]" />
        ) : (
          <AlertLayoutPreview layout={null} className="h-[132px] shrink-0 sm:h-[63px] sm:w-[112px]" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium" data-testid="text-linked-alert-name">
            {alert ? alert.name : alert === null ? "A library alert the dashboard hasn't seen yet" : "Library alert"}
          </span>
          <span className="text-xs text-muted-foreground">From the library. Plays its latest published version.</span>
        </div>
        <Button asChild variant="outline" className="h-11 w-full shrink-0 sm:h-9 sm:w-auto">
          <Link href={alertEditorHref} data-testid="link-edit-alert">
            Edit alert
          </Link>
        </Button>
      </div>
      {inputFields.length > 0 && (
        <TriggerConfigForm
          fields={inputFields}
          values={inputValues as TriggerConfigValues}
          onChange={(inputs) => onChange({ ...values, inputs: inputs as never })}
          availableVariables={availableVariables}
        />
      )}
      {warnings.map((warning) => (
        <p key={warning.inputId} className="text-xs text-destructive" data-testid={`warning-input-${warning.inputId}`}>
          {warning.label} uses {warning.references.join(", ")}, which isn't available to this step, so it plays empty.
        </p>
      ))}
    </div>
  );
}
