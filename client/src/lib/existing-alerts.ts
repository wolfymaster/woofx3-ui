import type { Doc } from "@convex/_generated/dataModel";
import type { ActionStep } from "@woofx3/api";
import type { AlertLayout } from "@/lib/alert-layout";
import { commandStepId } from "@/lib/command-drafts";
import { sentenceParts } from "@/lib/condition-sentence";
import { unescapeDollarKeys } from "@/lib/dollar-keys";
import { conditionFieldsOf } from "@/lib/event-workflow-state";
import { projectWorkflow } from "@/lib/trigger-projection";
import type { TriggerPreset } from "@/lib/workflow-presets";
import { conditionsToFieldValues } from "@/lib/workflow-presets-json";

/**
 * An alert already saved somewhere on the instance, offered as the starting point for
 * another one. Only its `layout` is copied, so `layout` is kept as stored and read by
 * the editor the same way it reads the step's own.
 */
export interface ExistingAlert {
  /** Where the alert lives; see triggerAlertKey and commandAlertKey. */
  key: string;
  source: "trigger" | "command";
  /** The event or command it belongs to. */
  title: string;
  /** Which trigger and step within it. */
  detail: string;
  layout: unknown;
}

/** The key of an alert step in an event's workflow. */
export function triggerAlertKey(engineWorkflowId: string, actionId: string): string {
  return `trigger:${engineWorkflowId}:${actionId}`;
}

/** The key of an alert step in a chat command. */
export function commandAlertKey(engineCommandId: string, stepId: string): string {
  return `command:${engineCommandId}:${stepId}`;
}

/**
 * Every alert in the event workflows the Alerts screen can show, in the order the
 * screen lists them. A workflow it cannot project was built in the workflow builder,
 * where its steps have no trigger to be named by, so it is left out.
 */
export function alertsInWorkflows(rows: readonly Doc<"workflows">[], triggerPresets: TriggerPreset[]): ExistingAlert[] {
  const alerts: ExistingAlert[] = [];
  for (const row of rows) {
    const projected = projectWorkflow(row);
    if (!projected.ok) {
      continue;
    }
    const { projection } = projected;
    const preset = triggerPresets.find((candidate) => candidate.event === projection.event);
    const title = preset?.name ?? projection.name;
    const conditionFields = conditionFieldsOf(preset);

    for (const trigger of projection.triggers) {
      const when =
        trigger.conditions.length === 0
          ? "Every time"
          : sentenceParts(
              preset?.sentence,
              conditionFields,
              conditionsToFieldValues(conditionFields, trigger.conditions)
            )
              .map((part) => part.text)
              .join("");
      trigger.actions.forEach((action, index) => {
        if (hasLayout(action.parameters.layout)) {
          alerts.push({
            key: triggerAlertKey(projection.engineWorkflowId, action.id),
            source: "trigger",
            title,
            detail: `${when} · Step ${index + 1}`,
            layout: action.parameters.layout,
          });
        }
      });
    }
    for (const action of projection.shared) {
      if (hasLayout(action.parameters.layout)) {
        alerts.push({
          key: triggerAlertKey(projection.engineWorkflowId, action.id),
          source: "trigger",
          title,
          detail: "Shared step",
          layout: action.parameters.layout,
        });
      }
    }
  }
  return alerts;
}

/** Every alert in the instance's chat commands, by command word. */
export function alertsInCommands(rows: readonly Doc<"chatCommands">[]): ExistingAlert[] {
  const alerts: ExistingAlert[] = [];
  const sorted = [...rows].sort((a, b) => a.command.localeCompare(b.command));
  for (const row of sorted) {
    const steps = unescapeDollarKeys(row.actions ?? []) as ActionStep[];
    steps.forEach((step, index) => {
      if (hasLayout(step.parameters?.layout)) {
        alerts.push({
          key: commandAlertKey(row.engineCommandId, commandStepId(step, index)),
          source: "command",
          title: `!${row.command}`,
          detail: `Step ${index + 1}`,
          layout: step.parameters?.layout,
        });
      }
    });
  }
  return alerts;
}

/**
 * A copy of a layout to start another alert from. Its layers get fresh ids in stacking
 * order and their settings are cloned, so the copy shares nothing with the alert it
 * came from and editing one never shows up in the other.
 */
export function copyAlertLayout(layout: AlertLayout): AlertLayout {
  const stacked = [...layout.widgets].sort((a, b) => a.zIndex - b.zIndex);
  return {
    width: layout.width,
    height: layout.height,
    widgets: stacked.map((widget, index) => ({
      ...structuredClone(widget),
      id: `w-${index + 1}`,
      zIndex: index + 1,
    })),
  };
}

/**
 * Whether a step's `layout` parameter is an alert layout with something on it. An empty layout is no
 * better a start than a new one, so it is not offered.
 */
function hasLayout(layout: unknown): boolean {
  if (typeof layout !== "object" || layout === null || Array.isArray(layout)) {
    return false;
  }
  const widgets = (layout as { widgets?: unknown }).widgets;
  return Array.isArray(widgets) && widgets.length > 0;
}
