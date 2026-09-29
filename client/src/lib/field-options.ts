/**
 * One option of a field whose options a worker lists at render time (a
 * manifest `source: { kind: "internal" }`). `value` is what the field saves,
 * `label` what the picker shows, and `group` the heading it is listed under.
 */
export type FieldOption = { value: string; label: string; group?: string };

export interface FieldOptionGroup {
  /** Null for options the worker listed without a group. */
  heading: string | null;
  options: FieldOption[];
}

/**
 * A worker's reply as options, or the reason it gave for having none. A string
 * item is its own value and label; an object item needs a string `value` and
 * `label`, and anything else in the list is dropped. `{ error }` is the
 * field-options failure reply; an engine that relays it as a success still
 * reaches the picker as a reason rather than as an empty list.
 */
export function parseFieldOptionsReply(data: unknown): { options: FieldOption[]; error: string | null } {
  if (!Array.isArray(data)) {
    const error =
      data !== null && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : null;
    return { options: [], error: error === "" ? null : error };
  }
  const options: FieldOption[] = [];
  for (const item of data) {
    if (typeof item === "string") {
      options.push({ value: item, label: item });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.value === "string" && typeof o.label === "string") {
        const option: FieldOption = { value: o.value, label: o.label };
        if (typeof o.group === "string" && o.group !== "") {
          option.group = o.group;
        }
        options.push(option);
      }
    }
  }
  return { options, error: null };
}

/** Options under their headings, headings in the order they first appear. */
export function groupFieldOptions(options: readonly FieldOption[]): FieldOptionGroup[] {
  const groups: FieldOptionGroup[] = [];
  const byHeading = new Map<string | null, FieldOptionGroup>();
  for (const option of options) {
    const heading = option.group ?? null;
    let group = byHeading.get(heading);
    if (!group) {
      group = { heading, options: [] };
      byHeading.set(heading, group);
      groups.push(group);
    }
    group.options.push(option);
  }
  return groups;
}

/** A value built from a workflow variable is only known when the step runs. */
function isExpression(value: string): boolean {
  return value.includes("${");
}

/**
 * Why a typed value is not one of the options, or null when it is (or cannot
 * be judged: empty, built from a variable, or nothing was listed). Workers
 * list names that are matched exactly, so a value differing only in case, or
 * carrying spaces at either end, is called out with the listed one.
 */
export function fieldOptionMismatch(value: unknown, options: readonly FieldOption[]): string | null {
  if (typeof value !== "string" || value === "" || isExpression(value) || options.length === 0) {
    return null;
  }
  const known = options.map((option) => option.value);
  if (known.includes(value)) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed !== value) {
    if (known.includes(trimmed)) {
      return `"${value}" has a space at the start or end, so it will not match "${trimmed}".`;
    }
    return `"${value}" has a space at the start or end, and names are matched exactly.`;
  }
  const lower = value.toLowerCase();
  const caseOnly = known.find((candidate) => candidate.toLowerCase() === lower);
  if (caseOnly !== undefined) {
    return `Did you mean "${caseOnly}"? Names are case-sensitive, so "${value}" will not match.`;
  }
  return `"${value}" is not one of the listed options.`;
}
