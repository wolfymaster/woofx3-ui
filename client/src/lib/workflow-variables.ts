import type { ConfigField, DataShapeField } from "@woofx3/api/ui-schema";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { parseConfigFields, parseDataShapeFields } from "@/lib/parse-config-fields";
import type { WaitConfig } from "@/lib/wait-config";
import { payloadFieldLabel, resolveWaitEvent } from "@/lib/wait-event";
import { resolveCatalogAction, resolveCatalogTrigger } from "@/lib/workflow-node-label";
import type { StepNode, WaitNode, WorkflowTree } from "@/lib/workflow-tree";

const STEP_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isValidStepId(id: string): boolean {
  return STEP_ID_PATTERN.test(id);
}

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "step";
}

/** A short, readable default id derived from the action's name (e.g. "Increment Counter" -> "increment-counter"),
 * disambiguated against every id already in the tree. Still just a starting point — editable afterward. */
export function generateStepId(label: string, existingIds: ReadonlySet<string>): string {
  const base = slugify(label);
  if (!existingIds.has(base)) {
    return base;
  }
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}

/** Every step id in the tree, including nested branches. Trigger isn't included —
 * it's addressed as the fixed "trigger" source, not by a user-editable id. */
export function collectStepIds(steps: StepNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: StepNode[]) => {
    for (const step of list) {
      ids.add(step.id);
      if (step.type === "condition") {
        walk(step.thenBranch);
        walk(step.elseBranch);
      }
    }
  };
  walk(steps);
  return ids;
}

/** Whether any step's fields (parameters, conditions, wait, ...) contain a ${stepId....} reference to the given
 * id — used to warn before a rename leaves those references dangling (renaming doesn't rewrite them). */
export function isStepIdReferenced(steps: StepNode[], stepId: string): boolean {
  const needle = `\${${stepId}.`;
  const containsReference = (value: unknown): boolean => {
    if (typeof value === "string") {
      return value.includes(needle);
    }
    if (Array.isArray(value)) {
      return value.some(containsReference);
    }
    if (value && typeof value === "object") {
      return Object.values(value).some(containsReference);
    }
    return false;
  };
  const walk = (list: StepNode[]): boolean => {
    for (const step of list) {
      if (step.type === "condition") {
        const { thenBranch, elseBranch, ...own } = step;
        if (containsReference(own) || walk(thenBranch) || walk(elseBranch)) {
          return true;
        }
      } else if (containsReference(step)) {
        return true;
      }
    }
    return false;
  };
  return walk(steps);
}

export interface VariableOption {
  /** The literal ${...} token to insert, e.g. "${increment.next}" or "${trigger.data.user}". */
  value: string;
  /** What the referenced field is called, e.g. "New value". */
  label: string;
  /** Which step (or "Trigger") this option came from, for grouping in the picker. */
  group: string;
  /** Declared type of the referenced value, e.g. "string" | "number" | "boolean".
   *  Comes from the catalog's own field definition — the engine already ships
   *  it, so nothing here has to guess or maintain a parallel schema. */
  type?: string;
  /** Prose from the catalog field, when the module author wrote any. */
  description?: string;
}

/**
 * Steps that would already have run by the time `targetId` executes: earlier siblings in
 * its own list, plus — walking up — each ancestor condition and everything before it in
 * that condition's own list. Matches the dependsOn chain `treeToDefinition` builds (see
 * its comment), so a variable offered here is always actually resolvable at runtime.
 * Returns null if targetId isn't found anywhere under `steps`.
 */
function collectPredecessorSteps(steps: StepNode[], targetId: string): StepNode[] | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.id === targetId) {
      return steps.slice(0, i);
    }
    if (step.type === "condition") {
      const inThen = collectPredecessorSteps(step.thenBranch, targetId);
      if (inThen) {
        return [...steps.slice(0, i), step, ...inThen];
      }
      const inElse = collectPredecessorSteps(step.elseBranch, targetId);
      if (inElse) {
        return [...steps.slice(0, i), step, ...inElse];
      }
    }
  }
  return null;
}

/**
 * Every ${...} variable a field on `currentNodeId` could reference right now: the
 * trigger's payload (`triggerVariables` when the surface supplies it, else what the tree's
 * catalog trigger emits), plus each predecessor action's declared return value, each
 * predecessor condition's boolean result and each predecessor wait's exports. Steps that haven't necessarily run yet by
 * the time `currentNodeId` executes (later siblings, sibling branches, descendants)
 * are excluded — offering them would suggest references the engine can't reliably
 * resolve.
 */
export function computeAvailableVariables(
  tree: WorkflowTree,
  currentNodeId: string,
  catalogActions: CatalogActionRow[],
  catalogTriggers: CatalogTriggerRow[],
  triggerVariables?: readonly VariableOption[]
): VariableOption[] {
  const options = triggerVariables ? [...triggerVariables] : catalogTriggerVariables(tree, catalogTriggers);

  const predecessors = collectPredecessorSteps(tree.steps, currentNodeId) ?? [];
  for (const step of predecessors) {
    if (step.type === "action") {
      const catalogRow = resolveCatalogAction(step, catalogActions);
      options.push(
        ...stepOutputVariables(step.id, catalogRow?.name ?? step.id, parseDataShapeFields(catalogRow?.returns))
      );
    } else if (step.type === "condition") {
      options.push({
        value: `\${${step.id}.result}`,
        label: "Condition result",
        group: "Condition",
        type: "boolean",
        description: "Whether this condition matched.",
      });
    } else if (step.type === "wait") {
      options.push(...waitExportVariables(step, catalogTriggers));
    }
  }

  return options;
}

function catalogTriggerVariables(tree: WorkflowTree, catalogTriggers: CatalogTriggerRow[]): VariableOption[] {
  const triggerRow = resolveCatalogTrigger(tree.trigger, catalogTriggers);
  return triggerDataVariables(parseDataShapeFields(triggerRow?.emits), parseConfigFields(triggerRow?.configFields));
}

/**
 * The catalog's description of the payload an event carries, when a trigger declares
 * that event; a chat command's `chat.command.hug` is described by `chat.command.*`.
 */
function eventPayloadFields(event: string, catalogTriggers: CatalogTriggerRow[]): DataShapeField[] {
  return resolveWaitEvent(event, catalogTriggers)?.choice.emits ?? [];
}

/**
 * What a finished wait hands later steps, as `${waitId.field}`. Must match GetExports in
 * the engine's workflow/internal/tasks/wait.go: every aggregation keeps both `count` and
 * `sum`, whichever strategy decides it, and a wait that ends without an event has an
 * empty `data` whose fields read as empty. A delay's exports never vary (always
 * satisfied, never an event), so it offers none.
 */
export function waitExportVariables(step: WaitNode, catalogTriggers: CatalogTriggerRow[]): VariableOption[] {
  const wait: WaitConfig = step.wait;
  if (wait.type === "delay") {
    return [];
  }
  const group = `Wait (${step.id})`;
  const ref = (path: string) => `\${${step.id}.${path}}`;
  const noEventNote =
    wait.timeout && wait.onTimeout === "continue" ? " Empty if it gave up before any event matched." : "";

  const options: VariableOption[] = [
    {
      value: ref("satisfied"),
      label: "Whether it happened",
      group,
      type: "boolean",
      description: "Whether the wait got what it was waiting for.",
    },
    {
      value: ref("timedOut"),
      label: "Whether it gave up",
      group,
      type: "boolean",
      description: "Whether the wait gave up when its time limit ran out.",
    },
    { value: ref("events"), label: "Every match", group, type: "array", description: "Every event that matched." },
  ];
  if (wait.aggregation) {
    options.push(
      {
        value: ref("count"),
        label: "How many happened",
        group,
        type: "number",
        description: "How many events matched.",
      },
      {
        value: ref("sum"),
        label: "Their total",
        group,
        type: "number",
        description: wait.aggregation.field
          ? `The total of their ${wait.aggregation.field.replace(/^data\./, "")}.`
          : "The total of their amount, or of their value.",
      }
    );
  }
  options.push({
    value: ref("lastEvent"),
    label: "The last match",
    group,
    type: "object",
    description: `The last event that matched.${noEventNote}`,
  });

  const payload = eventPayloadFields(wait.event, catalogTriggers);
  if (payload.length === 0) {
    options.push({
      value: ref("data"),
      label: "Its details",
      group,
      type: "object",
      description: `The last matching event's payload.${noEventNote}`,
    });
  } else {
    for (const field of payload) {
      const description = field.description ?? "From the last matching event.";
      options.push({
        value: ref(`data.${field.path}`),
        label: payloadFieldLabel(field.path),
        group,
        type: field.type,
        description: `${description}${noEventNote}`,
      });
    }
  }
  return options;
}

/**
 * A trigger's payload comes from its declared `emits` when it has one. Otherwise it
 * falls back to deriving variables from config fields carrying an `eventPath`, which
 * is all that was available before triggers could describe their payload — and which
 * can only ever name keys that happen to also be config fields.
 */
function triggerDataVariables(
  emits: readonly DataShapeField[],
  configFields: readonly ConfigField[]
): VariableOption[] {
  if (emits.length > 0) {
    return emits.map((field) => ({
      value: `\${trigger.data.${field.path}}`,
      label: field.path,
      group: "Trigger",
      type: field.type,
      description: field.description,
    }));
  }
  return configFields
    .filter((field) => field.eventPath)
    .map((field) => ({
      value: `\${trigger.data.${field.eventPath}}`,
      label: field.label,
      group: "Trigger",
      type: field.type,
      description: field.description,
    }));
}

/** What a step's declared return value offers later steps, as `${stepId.path}` references. */
export function stepOutputVariables(
  stepId: string,
  group: string,
  returns: readonly DataShapeField[]
): VariableOption[] {
  return returns.map((field) => ({
    value: `\${${stepId}.${field.path}}`,
    label: field.path,
    group,
    type: field.type,
    description: field.description,
  }));
}
