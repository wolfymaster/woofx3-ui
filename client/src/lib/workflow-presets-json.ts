import type { ConditionConfig, TaskDefinition, WorkflowDefinition } from "@woofx3/api";
import type { ActionPreset, ConfigValue, TierConfig, TriggerConfigValues, TriggerPreset } from "./workflow-presets";

type TriggerWithEvent = TriggerPreset & { event?: string };

function triggerEventType(t: TriggerWithEvent): string {
  if (!t.event) {
    throw new Error(`Trigger preset "${t.id}" is missing an "event" field`);
  }
  return t.event;
}

function configValuesToConditions(values: TriggerConfigValues): ConditionConfig[] {
  // Preset trigger config fields that aren't "amount" are used as trigger-level
  // conditions. Amount is handled per-tier via buildTieredDefinition.
  const out: ConditionConfig[] = [];
  for (const [key, raw] of Object.entries(values)) {
    if (key === "amount") {
      continue;
    }
    if (raw === null || raw === undefined || raw === "") {
      continue;
    }
    out.push({
      field: `\${trigger.data.${key}}`,
      operator: "eq",
      value: raw as unknown,
    });
  }
  return out;
}

function actionParameters(action: ActionPreset, actionConfig: TriggerConfigValues): Record<string, unknown> {
  return { action: action.id, ...actionConfig };
}

export function buildDefinitionFromPresets(
  trigger: TriggerWithEvent,
  action: ActionPreset,
  triggerConfig: TriggerConfigValues,
  actionConfig: TriggerConfigValues
): Omit<WorkflowDefinition, "id"> {
  return {
    name: `${trigger.name} → ${action.name}`,
    description: `When ${trigger.description.toLowerCase()}, ${action.description.toLowerCase()}.`,
    trigger: {
      type: "event",
      eventType: triggerEventType(trigger),
      conditions: configValuesToConditions(triggerConfig),
    },
    tasks: [
      {
        id: "action-1",
        type: "action",
        parameters: actionParameters(action, actionConfig),
      },
    ],
  };
}

function amountToCondition(amount: ConfigValue | undefined): ConditionConfig | null {
  if (!amount) {
    return null;
  }
  if (amount.type === "single" && amount.value !== undefined) {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
    return { field: "${trigger.data.amount}", operator: "eq", value: amount.value };
  }
  if (amount.type === "range" && amount.min !== undefined && amount.max !== undefined) {
    return {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
      field: "${trigger.data.amount}",
      operator: "between",
      value: [amount.min, amount.max],
    };
  }
  return null;
}

export function buildTieredDefinition(trigger: TriggerWithEvent, tiers: TierConfig[]): Omit<WorkflowDefinition, "id"> {
  const tasks: TaskDefinition[] = [];
  tiers.forEach((tier, i) => {
    if (!tier.action) {
      return;
    }
    const checkId = `tier-${i + 1}-check`;
    const actionId = `tier-${i + 1}-action`;
    const cond = amountToCondition(tier.values.amount as ConfigValue | undefined);
    tasks.push({
      id: checkId,
      type: "condition",
      conditions: cond ? [cond] : [],
      onTrue: [actionId],
    });
    tasks.push({
      id: actionId,
      type: "action",
      dependsOn: [checkId],
      parameters: actionParameters(tier.action, tier.actionConfig),
    });
  });

  return {
    name: `${trigger.name} — tiered`,
    description: `Multi-tier ${trigger.name.toLowerCase()} automation.`,
    trigger: { type: "event", eventType: triggerEventType(trigger), conditions: [] },
    tasks,
  };
}
