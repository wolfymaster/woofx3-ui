import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { parseConfigFields, parseDataShapeFields } from "@/lib/parse-config-fields";
import { resolveCatalogAction, resolveCatalogTrigger } from "@/lib/workflow-node-label";
import type { StepNode, WorkflowTree } from "@/lib/workflow-tree";

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

/** Every step id in the tree (condition/wait/action), including nested branches. Trigger isn't included —
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

/** Whether any step's parameters/conditions contain a ${stepId....} reference to the given id — used to warn
 * before a rename leaves those references dangling (renaming doesn't rewrite them). */
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
      if (step.type === "action" && containsReference(step.parameters)) {
        return true;
      }
      if (step.type === "condition") {
        if (containsReference(step.conditions)) {
          return true;
        }
        if (walk(step.thenBranch) || walk(step.elseBranch)) {
          return true;
        }
      }
      if (step.type === "wait" && containsReference(step.wait)) {
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
 * trigger's payload, plus each predecessor action's declared return value and each
 * predecessor condition's boolean result. Steps that haven't necessarily run yet by
 * the time `currentNodeId` executes (later siblings, sibling branches, descendants)
 * are excluded — offering them would suggest references the engine can't reliably
 * resolve.
 *
 * A trigger's payload comes from its declared `emits` when it has one. Otherwise it
 * falls back to deriving variables from config fields carrying an `eventPath`, which
 * is all that was available before triggers could describe their payload — and which
 * can only ever name keys that happen to also be config fields.
 */
export function computeAvailableVariables(
  tree: WorkflowTree,
  currentNodeId: string,
  catalogActions: CatalogActionRow[],
  catalogTriggers: CatalogTriggerRow[]
): VariableOption[] {
  const options: VariableOption[] = [];

  const triggerRow = resolveCatalogTrigger(tree.trigger, catalogTriggers);
  const emitted = parseDataShapeFields(triggerRow?.emits);
  if (emitted.length > 0) {
    for (const field of emitted) {
      options.push({
        value: `\${trigger.data.${field.path}}`,
        label: field.path,
        group: "Trigger",
        type: field.type,
        description: field.description,
      });
    }
  } else {
    for (const field of parseConfigFields(triggerRow?.configFields)) {
      if (field.eventPath) {
        options.push({
          value: `\${trigger.data.${field.eventPath}}`,
          label: field.label,
          group: "Trigger",
          type: field.type,
          description: field.description,
        });
      }
    }
  }

  const predecessors = collectPredecessorSteps(tree.steps, currentNodeId) ?? [];
  for (const step of predecessors) {
    if (step.type === "action") {
      const catalogRow = resolveCatalogAction(step, catalogActions);
      const group = catalogRow?.name ?? step.id;
      for (const field of parseDataShapeFields(catalogRow?.returns)) {
        options.push({
          value: `\${${step.id}.${field.path}}`,
          label: field.path,
          group,
          type: field.type,
          description: field.description,
        });
      }
    } else if (step.type === "condition") {
      options.push({
        value: `\${${step.id}.result}`,
        label: "Condition result",
        group: "Condition",
        type: "boolean",
        description: "Whether this condition matched.",
      });
    }
  }

  return options;
}
