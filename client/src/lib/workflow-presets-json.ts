import type { ConditionConfig, TaskDefinition, WorkflowDefinition } from "@woofx3/api";
import type {
  ActionPreset,
  ConfigField,
  ConfigValue,
  TierConfig,
  TriggerConfigValues,
  TriggerPreset,
} from "./workflow-presets";

type TriggerWithEvent = TriggerPreset & { event?: string };

function triggerBaseEvent(t: TriggerWithEvent): string {
  if (!t.event) {
    throw new Error(`Trigger preset "${t.id}" is missing an "event" field`);
  }
  return t.event;
}

// Parameterized triggers expose a ConfigField with a dynamic `source` — the
// picked value is appended to the base event, yielding the concrete NATS
// subject the engine will subscribe to (e.g. `chat.command.hello`). The rule
// is intentionally generic: any single dynamic-source field works, so future
// triggers can reuse the pattern without special-casing the builder.
function assembleEventType(trigger: TriggerWithEvent, config: TriggerConfigValues): string {
  const base = triggerBaseEvent(trigger);
  const fields: ConfigField[] = trigger.config?.fields ?? [];
  const dynamic = fields.filter((f) => f.source !== undefined);
  if (dynamic.length === 0) {
    return base;
  }
  if (dynamic.length > 1) {
    throw new Error(`trigger "${trigger.id}": multiple dynamic-source fields not yet supported`);
  }
  const field = dynamic[0];
  const value = config[field.id];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`trigger "${trigger.id}": config field "${field.id}" missing or not a string`);
  }
  return `${base}.${value}`;
}

function configValuesToConditions(values: TriggerConfigValues, trigger: TriggerWithEvent): ConditionConfig[] {
  // Preset trigger config fields that aren't "amount" are used as trigger-level
  // conditions. Amount is handled per-tier via buildTieredDefinition. Dynamic-
  // source fields are consumed by assembleEventType to build the subject, so
  // they must not also appear as payload conditions.
  const fields: ConfigField[] = trigger.config?.fields ?? [];
  const dynamicIds = new Set(fields.filter((f) => f.source !== undefined).map((f) => f.id));
  const out: ConditionConfig[] = [];
  for (const [key, raw] of Object.entries(values)) {
    if (key === "amount") {
      continue;
    }
    if (dynamicIds.has(key)) {
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
      event: assembleEventType(trigger, triggerConfig),
      conditions: configValuesToConditions(triggerConfig, trigger),
    },
    tasks: [
      {
        id: "action-1",
        type: "action",
        action: action.id,
        parameters: { ...actionConfig },
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
      action: tier.action.id,
      dependsOn: [checkId],
      parameters: { ...tier.actionConfig },
    });
  });

  // Tiered triggers share a single subject across all variants, so the
  // dynamic-source value is pulled from the first tier's config; picking any
  // tier would yield the same subject.
  const firstTierValues = tiers[0]?.values ?? {};
  return {
    name: `${trigger.name} — tiered`,
    description: `Multi-tier ${trigger.name.toLowerCase()} automation.`,
    trigger: { type: "event", event: assembleEventType(trigger, firstTierValues), conditions: [] },
    tasks,
  };
}
