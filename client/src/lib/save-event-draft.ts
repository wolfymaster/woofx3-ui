import type { Id } from "@convex/_generated/dataModel";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { type EventEditorState, getDraft, setDraft } from "@/lib/event-drafts";
import { buildWorkflowDefinition, UNCONDITIONAL_TRIGGER_ID } from "@/lib/trigger-projection";
import { fieldValuesToConditions, incompleteConditionFields } from "@/lib/workflow-presets-json";

/** A trigger that can't be saved yet, and the condition fields it still needs a value for. */
export interface IncompleteTrigger {
  triggerId: string;
  fields: ConfigField[];
}

/**
 * The first trigger still missing a condition value, or null when every one is finished.
 * The unconditional trigger has no conditions to miss.
 */
export function firstIncompleteTrigger(
  state: EventEditorState,
  conditionFields: ConfigField[]
): IncompleteTrigger | null {
  for (const trigger of state.triggers) {
    if (trigger.id === UNCONDITIONAL_TRIGGER_ID) {
      continue;
    }
    const fields = incompleteConditionFields(conditionFields, state.conditionValues[trigger.id] ?? {});
    if (fields.length > 0) {
      return { triggerId: trigger.id, fields };
    }
  }
  return null;
}

/** The engine writes saving needs, as a screen's `useAction` handles supply them. */
export interface EngineWorkflowWriters {
  instanceId: Id<"instances">;
  createFromDefinition: (args: {
    instanceId: Id<"instances">;
    definition: never;
  }) => Promise<{ engineWorkflowId: string }>;
  updateFromDefinition: (args: {
    instanceId: Id<"instances">;
    engineWorkflowId: string;
    definition: never;
  }) => Promise<unknown>;
  setEnabled: (args: { instanceId: Id<"instances">; engineWorkflowId: string; isEnabled: boolean }) => Promise<unknown>;
}

/**
 * Writes one event's draft to the engine as a single workflow, then re-baselines the
 * draft so the screen reads as saved.
 *
 * Throws whatever the engine call threw; the caller decides how to say so. A workflow
 * created here is enabled straight away, because a trigger the user just wrote is meant
 * to fire — but failing to enable it is not a failure to save, so it is reported rather
 * than thrown.
 */
export async function saveEventDraft(
  event: string,
  state: EventEditorState,
  conditionFields: ConfigField[],
  writers: EngineWorkflowWriters
): Promise<{ enabled: boolean }> {
  const triggers = state.triggers.map((trigger) => ({
    ...trigger,
    conditions:
      trigger.id === UNCONDITIONAL_TRIGGER_ID
        ? []
        : fieldValuesToConditions(conditionFields, state.conditionValues[trigger.id] ?? {}),
  }));

  const definition = buildWorkflowDefinition({
    event,
    name: state.name,
    triggers,
    shared: state.shared,
    engineWorkflowId: state.engineWorkflowId,
  });

  let enabled = true;
  if (state.engineWorkflowId) {
    await writers.updateFromDefinition({
      instanceId: writers.instanceId,
      engineWorkflowId: state.engineWorkflowId,
      definition: escapeDollarKeys(definition) as never,
    });
  } else {
    const created = await writers.createFromDefinition({
      instanceId: writers.instanceId,
      definition: escapeDollarKeys(definition) as never,
    });
    try {
      await writers.setEnabled({
        instanceId: writers.instanceId,
        engineWorkflowId: created.engineWorkflowId,
        isEnabled: true,
      });
    } catch {
      enabled = false;
    }
  }

  const saved = getDraft(event);
  if (saved) {
    setDraft(event, { ...saved, baseline: JSON.stringify(saved.value) });
  }
  return { enabled };
}
