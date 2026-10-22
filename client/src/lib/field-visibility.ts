import { type ConfigField, isFieldVisible } from "@woofx3/api/ui-schema";

type ConditionedField = { id: string } & Pick<ConfigField, "visibleWhen">;
type Values = Record<string, unknown>;

/** Whether `value` is (or starts with) a `${...}` reference to an earlier value in the workflow. */
export function isVariableReference(value: unknown): value is string {
  return typeof value === "string" && value.trim().startsWith("${");
}

/**
 * Whether the form shows `field` for `values`. A controller holding a `${...}`
 * reference has no value to compare until the workflow runs, so the dependent
 * field stays visible rather than vanishing behind a variable.
 */
export function isFieldShown(field: ConditionedField, values: Values): boolean {
  const controller = field.visibleWhen?.field;
  if (controller !== undefined && isVariableReference(values[controller])) {
    return true;
  }
  return isFieldVisible(field as ConfigField, values);
}

/** `values` without the entries of fields the form is not showing, so a hidden choice is never saved. */
export function dropHiddenValues(fields: readonly ConditionedField[], values: Values): Values {
  const out = { ...values };
  for (const field of fields) {
    if (!isFieldShown(field, values)) {
      delete out[field.id];
    }
  }
  return out;
}

/**
 * Settle the fields a change shows or hides: one that just became hidden loses
 * its value, one that just became visible starts from its default instead of
 * whatever was typed before it was hidden.
 */
export function applyVisibilityChange<F extends ConditionedField>(
  fields: readonly F[],
  before: Values,
  after: Values,
  defaultFor: (field: F) => unknown
): Values {
  const out = { ...after };
  for (const field of fields) {
    const wasShown = isFieldShown(field, before);
    const isShown = isFieldShown(field, after);
    if (wasShown && !isShown) {
      delete out[field.id];
    } else if (!wasShown && isShown) {
      out[field.id] = defaultFor(field);
    }
  }
  return out;
}
