import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Bell, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertLayoutEditor } from "@/components/alert-editor/alert-layout-editor";
import { EmptyState } from "@/components/common/empty-state";
import type { LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { FieldOptionsLoader } from "@/components/triggers/field-options-loader";
import { useEventWorkflowDraft } from "@/hooks/use-event-workflow-draft";
import { useInstance } from "@/hooks/use-instance";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { alertMenuPath } from "@/lib/alert-groups";
import { sentenceParts } from "@/lib/condition-sentence";
import { updateDraftValue } from "@/lib/event-drafts";
import { isCommandsSource, isInternalSource } from "@/lib/parse-config-fields";
import type { ActionPreset } from "@/lib/workflow-presets";
import { projectedActionVariables } from "@/lib/workflow-variables";

/**
 * One trigger step's alert content, on its own route.
 *
 * The editing itself is AlertLayoutEditor; this finds the step the route names and wires
 * it to the event's draft (lib/event-drafts.ts). Done hands the layout back to that
 * draft and returns to the triggers page, where it waits with the page's other unsaved
 * edits for Save; Cancel and Back drop it.
 */
export default function AlertEditorPage() {
  const params = useParams<{ event: string; triggerId: string; actionId: string }>();
  const event = decodeParam(params.event);
  const triggerId = decodeParam(params.triggerId);
  const actionId = decodeParam(params.actionId);
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const { triggerPresets, actionPresets, loading: catalogLoading } = useWorkflowCatalog();
  const workflows = useQuery(api.workflows.list, instance ? { instanceId: instance._id as Id<"instances"> } : "skip");

  const triggerPreset = triggerPresets.find((preset) => preset.event === event);
  const conditionFields = useMemo(
    () => (triggerPreset?.config?.fields ?? []).filter((field) => !isCommandsSource(field)),
    [triggerPreset]
  );
  const { draft } = useEventWorkflowDraft(triggerPreset, conditionFields, workflows as Doc<"workflows">[] | undefined);

  const [loadedOptions, setLoadedOptions] = useState<ReadonlyMap<string, LoadedFieldOptions>>(new Map());
  const handleOptionsLoaded = useCallback((fieldId: string, entry: LoadedFieldOptions) => {
    setLoadedOptions((previous) => new Map(previous).set(fieldId, entry));
  }, []);

  const trigger = draft?.value.triggers.find((candidate) => candidate.id === triggerId);
  const actionIndex = trigger?.actions.findIndex((candidate) => candidate.id === actionId) ?? -1;
  const action = trigger && actionIndex >= 0 ? trigger.actions[actionIndex] : undefined;

  const resolveActionPreset = useCallback(
    (candidate: { functionCall?: string; handlerType: string }): ActionPreset | undefined =>
      actionPresets.find((preset) =>
        candidate.functionCall
          ? preset.functionCall === candidate.functionCall
          : preset.handlerType === candidate.handlerType
      ),
    [actionPresets]
  );
  const availableVariables = useMemo(
    () =>
      triggerPreset && trigger && actionIndex >= 0
        ? projectedActionVariables(triggerPreset, trigger.actions, actionIndex, resolveActionPreset)
        : [],
    [triggerPreset, trigger, actionIndex, resolveActionPreset]
  );

  const menuPath = triggerPreset ? alertMenuPath(triggerPreset) : undefined;
  const backHref = menuPath ? `/stream/alerts/${menuPath.map(encodeURIComponent).join("/")}` : "/stream/alerts";

  const keepLayout = (stored: unknown) => {
    updateDraftValue(event, (current) => ({
      ...current,
      triggers: current.triggers.map((t) =>
        t.id === triggerId
          ? {
              ...t,
              actions: t.actions.map((a) =>
                a.id === actionId ? { ...a, parameters: { ...a.parameters, layout: stored as never } } : a
              ),
            }
          : t
      ),
    }));
  };

  if (catalogLoading || workflows === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!triggerPreset || !trigger || !action) {
    return (
      <div className="p-8">
        <EmptyState
          icon={Bell}
          title="This alert isn't here any more"
          description="The trigger or step it belonged to was removed, or the link is from another instance."
          action={{ label: "Back to alerts", onClick: () => navigate(backHref) }}
        />
      </div>
    );
  }

  const parts = sentenceParts(
    triggerPreset.sentence,
    conditionFields,
    draft?.value.conditionValues[trigger.id] ?? {},
    new Map(
      Array.from(loadedOptions.entries()).map(([fieldId, entry]) => [
        fieldId,
        new Map(entry.options.map((option) => [option.value, option.label])),
      ])
    )
  );

  const context = (
    <>
      {triggerPreset.name} ·{" "}
      {parts.map((part, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: sentence parts are positional and never reorder
          key={index}
          className={part.kind === "field" ? "font-medium text-foreground" : undefined}
        >
          {part.text}
        </span>
      ))}{" "}
      · Step {actionIndex + 1}
    </>
  );

  return (
    <>
      {conditionFields.filter(isInternalSource).map((field) => (
        <FieldOptionsLoader key={field.id} field={field} onLoaded={handleOptionsLoaded} />
      ))}
      <AlertLayoutEditor
        value={action.parameters.layout}
        context={context}
        backLabel={triggerPreset.name}
        availableVariables={availableVariables}
        onDone={(stored) => {
          if (stored !== null) {
            keepLayout(stored);
          }
          navigate(backHref);
        }}
        onCancel={() => navigate(backHref)}
      />
    </>
  );
}

/** A route segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
function decodeParam(segment: string | undefined): string {
  if (!segment) {
    return "";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
