import type { ConditionConfig, ConditionOperator } from "@woofx3/api";
import type { CatalogActionRow } from "@/hooks/use-workflow-catalog";
import { nameWithThing, type StepTarget } from "@/lib/action-objects";
import { conditionValueText } from "@/lib/condition-value";
import { describeWaitTimeout, isDelayWait, waitNodeLabel } from "@/lib/wait-config";
import { actionNodeSummary } from "@/lib/workflow-node-summary";
import { isEditableStep, type StepNode, stepKindLabel } from "@/lib/workflow-tree";

/** How a collapsed step reads in the flow. */
export interface StepSummary {
  /** The step on one line: an action's name, "If …", "Pause for 5 seconds". */
  title: string;
  /** Short facts after the title: configured settings, a wait's time limit, a guard. */
  details: string[];
  /** False for steps the flow keeps as they are and has no editor for. */
  editable: boolean;
}

export interface StepSummaryContext {
  /** The catalog action an action step runs, when the catalog has it. */
  action?: CatalogActionRow;
  /** Display names of the streamer's counters, timers and queues, by canonical id. */
  resourceLabels?: Map<string, string>;
  /**
   * The thing an action step points at (see stepTarget). Its name goes into the
   * title the way the picker words the step, "Increment Hype counter", and its
   * setting leaves the details.
   */
  target?: StepTarget;
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

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
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

function baseSummary(step: StepNode, context: StepSummaryContext): Pick<StepSummary, "title" | "details"> {
  switch (step.type) {
    case "action": {
      const name = context.action?.name ?? step.action ?? "Action";
      const target = context.action ? context.target : undefined;
      const title = target ? nameWithThing(name, target.field, target.label) : name;
      const omit = target ? new Set([target.field.id]) : undefined;
      const details = context.action ? actionNodeSummary(step, [context.action], context.resourceLabels, omit) : [];
      return { title, details };
    }
    case "condition": {
      const all = [...step.conditions, ...(step.condition ? [step.condition] : [])];
      const text = conditionsText(all, step.conditionLogic);
      return { title: text ? `If ${text}` : "If …", details: text ? [] : ["No conditions yet"] };
    }
    case "wait": {
      if (isDelayWait(step.wait)) {
        return { title: `Pause for ${waitNodeLabel(step.wait)}`, details: [] };
      }
      return { title: `Wait ${lowerFirst(waitNodeLabel(step.wait))}`, details: [describeWaitTimeout(step.wait)] };
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
 * The collapsed row of a step. Actions read as their catalog name followed by their
 * configured settings; this is the one place that decides it, so a sentence built from
 * the action's manifest can replace it without touching the flow.
 */
export function stepSummary(step: StepNode, context: StepSummaryContext = {}): StepSummary {
  const base = baseSummary(step, context);
  const editable = isEditableStep(step);
  const details = [...base.details, ...stepFlags(step)];
  if (!editable) {
    details.push("Kept as is on save");
  }
  return { title: base.title, details, editable };
}
