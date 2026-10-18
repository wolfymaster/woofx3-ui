import type { ConditionConfig, ConditionOperator } from "@woofx3/api";
import type { ConfigField } from "@woofx3/api/ui-schema";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { nameWithThing, type StepTarget } from "@/lib/action-objects";
import { actionSentenceParts } from "@/lib/action-sentence";
import { missingSettings } from "@/lib/action-settings";
import { type OptionLabels, type SentencePart, sentenceText } from "@/lib/condition-sentence";
import { conditionValueText } from "@/lib/condition-value";
import { parseConfigFields } from "@/lib/parse-config-fields";
import { placementChoices, type SceneRow, sceneChoices } from "@/lib/scene-field-options";
import { describeWaitTimeout, isDelayWait, waitNodeLabel } from "@/lib/wait-config";
import { waitEventIncomplete, waitSentence } from "@/lib/wait-event";
import { type ActionNode, isEditableStep, type StepNode, stepKindLabel } from "@/lib/workflow-tree";

/** How a collapsed step reads in the flow. */
export interface StepSummary {
  /** The step on one line: an action's sentence, "If …", "Pause for 5 seconds". */
  title: string;
  /** The title in parts, for an action whose sentence marks what is configured and what is missing. */
  parts?: SentencePart[];
  /** Short facts after the title: a wait's time limit, a guard. */
  details: string[];
  /** An action's required settings still empty, by label; it can't run until they are filled. */
  needs?: string[];
  /** False for steps the flow keeps as they are and has no editor for. */
  editable: boolean;
}

export interface StepSummaryContext {
  /** The catalog action an action step runs, when the catalog has it. */
  action?: CatalogActionRow;
  /** Display names of the streamer's counters, timers and queues, by canonical id. */
  resourceLabels?: Map<string, string>;
  /** The streamer's scenes, for the names of a scene and the widgets placed on it. */
  scenes?: readonly SceneRow[];
  /**
   * The thing an action step points at (see stepTarget), for callers that know its
   * name but not every resource label. The sentence names it in that setting's place;
   * an action without a sentence reads the way the picker words it, "Increment Hype
   * counter", and leaves that setting out.
   */
  target?: StepTarget;
  /** The events a wait can listen for, which name its event and its settings. */
  catalogTriggers?: CatalogTriggerRow[];
}

const OPERATOR_PHRASES: Record<ConditionOperator, string> = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  in: "is one of",
  not_in: "is not one of",
  exists: "is set",
  not_exists: "is not set",
  regex: "matches",
  between: "is between",
};

/** One condition as text: "trigger.data.amount is at least 100". */
export function conditionText(condition: ConditionConfig): string {
  const operator = OPERATOR_PHRASES[condition.operator] ?? condition.operator;
  if (condition.operator === "exists" || condition.operator === "not_exists") {
    return `${condition.field} ${operator}`;
  }
  if (condition.operator === "between" && Array.isArray(condition.value) && condition.value.length === 2) {
    return `${condition.field} ${operator} ${String(condition.value[0])} and ${String(condition.value[1])}`;
  }
  return `${condition.field} ${operator} ${conditionValueText(condition.value)}`;
}

/** Conditions joined the way the engine combines them; empty when there are none. */
export function conditionsText(conditions: readonly ConditionConfig[], logic: "and" | "or" | undefined): string {
  return conditions.map(conditionText).join(logic === "or" ? " or " : " and ");
}

/** The conditions a non-condition step is skipped without, and whether it is turned off. */
function stepFlags(step: StepNode): string[] {
  if (step.type === "unknown") {
    return [];
  }
  const flags: string[] = [];
  if (step.disabled) {
    flags.push("Turned off");
  }
  if (step.type !== "condition") {
    const guards = [...(step.conditions ?? []), ...(step.condition ? [step.condition] : [])];
    if (guards.length > 0) {
      flags.push(`Only if ${conditionsText(guards, step.conditionLogic)}`);
    }
  }
  return flags;
}

type BaseSummary = Pick<StepSummary, "title" | "details" | "parts" | "needs">;

/**
 * Labels for the values an action's settings store as ids: the streamer's counters by
 * canonical id, scenes by engine id, and the widgets placed on the step's chosen scene.
 */
export function actionOptionLabels(
  fields: readonly ConfigField[],
  parameters: Record<string, unknown>,
  context: Pick<StepSummaryContext, "resourceLabels" | "scenes">
): OptionLabels {
  const labels = new Map<string, ReadonlyMap<string, string>>();
  for (const field of fields) {
    if (field.type === "resource_ref" && context.resourceLabels) {
      labels.set(field.id, context.resourceLabels);
    } else if (field.source?.kind === "scenes" && context.scenes) {
      labels.set(field.id, choiceLabels(sceneChoices(context.scenes)));
    } else if (field.source?.kind === "scenePlacements" && context.scenes) {
      const choices = placementChoices(context.scenes, parameters[field.source.sceneField]);
      labels.set(field.id, choiceLabels(choices));
    }
  }
  return labels;
}

function choiceLabels(choices: readonly { value: string; label: string }[]): ReadonlyMap<string, string> {
  return new Map(choices.map((choice) => [choice.value, choice.label]));
}

function actionSummary(step: ActionNode, context: StepSummaryContext): BaseSummary {
  const action = context.action;
  if (!action) {
    return { title: step.action ?? "Action", details: [] };
  }
  const fields = parseConfigFields(action.configFields);
  const labels = new Map(actionOptionLabels(fields, step.parameters, context));
  const target = context.target;
  const value = target ? step.parameters[target.field.id] : undefined;
  if (target && typeof value === "string") {
    labels.set(target.field.id, new Map([[value, target.label]]));
  }
  const declaresSentence = action.sentence !== undefined && action.sentence.trim() !== "";
  const parts =
    target && !declaresSentence
      ? actionSentenceParts(
          { name: nameWithThing(action.name, target.field, target.label) },
          fields.filter((field) => field.id !== target.field.id),
          step.parameters,
          labels
        )
      : actionSentenceParts(action, fields, step.parameters, labels);
  const needs = missingSettings(fields, step.parameters).map((field) => field.label);
  return { title: sentenceText(parts), parts, details: [], needs };
}

function baseSummary(step: StepNode, context: StepSummaryContext): BaseSummary {
  switch (step.type) {
    case "action":
      return actionSummary(step, context);
    case "condition": {
      const all = [...step.conditions, ...(step.condition ? [step.condition] : [])];
      const text = conditionsText(all, step.conditionLogic);
      return { title: text ? `If ${text}` : "If …", details: text ? [] : ["No conditions yet"] };
    }
    case "wait": {
      if (isDelayWait(step.wait)) {
        return { title: `Pause for ${waitNodeLabel(step.wait)}`, details: [] };
      }
      const details = [describeWaitTimeout(step.wait)];
      if (step.wait.event.trim() === "") {
        details.unshift("Pick what to wait for");
      } else if (waitEventIncomplete(step.wait.event)) {
        details.unshift("Name which one to wait for");
      }
      return { title: waitSentence(step.wait, context.catalogTriggers ?? [], context.resourceLabels), details };
    }
    case "log": {
      const message = step.parameters?.message;
      return { title: typeof message === "string" && message !== "" ? `Log "${message}"` : "Log", details: [] };
    }
    case "workflow":
      return {
        title: step.workflow?.workflowId ? `Run workflow ${step.workflow.workflowId}` : "Run workflow",
        details: [],
      };
    case "unknown":
      return { title: stepKindLabel(step), details: [] };
  }
}

/**
 * The collapsed row of a step. An action reads as its sentence (see action-sentence.ts)
 * and names the required settings it still needs; this is the one place that decides
 * how a step reads, so the flow only lays it out.
 */
export function stepSummary(step: StepNode, context: StepSummaryContext = {}): StepSummary {
  const base = baseSummary(step, context);
  const editable = isEditableStep(step);
  const details = [...base.details, ...stepFlags(step)];
  if (!editable) {
    details.push("Kept as is on save");
  }
  return {
    title: base.title,
    ...(base.parts ? { parts: base.parts } : {}),
    details,
    ...(base.needs && base.needs.length > 0 ? { needs: base.needs } : {}),
    editable,
  };
}
