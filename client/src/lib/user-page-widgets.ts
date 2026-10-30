import { type FormField, type FormFieldType, type PageWidget, USER_PAGE_LIMITS } from "@shared/user-pages";

/** The question types a form offers, in the order its type picker lists them. */
export const FORM_FIELD_TYPES: readonly { type: FormFieldType; label: string }[] = [
  { type: "text", label: "Short answer" },
  { type: "textarea", label: "Long answer" },
  { type: "select", label: "Choice" },
  { type: "checkbox", label: "Checkbox" },
];

/** A newly added question: a short answer allowed the longest a short answer may be. */
export function newFormField(id: string): FormField {
  return { id, type: "text", label: "", required: false, maxLength: USER_PAGE_LIMITS.formTextAnswerLength };
}

/**
 * The question as another type. What every type shares (id, label, required)
 * is kept; the type's own settings start at their defaults, apart from a
 * text answer's length moving between short and long, which is clamped to
 * the new type's ceiling.
 */
export function formFieldOfType(field: FormField, type: FormFieldType): FormField {
  if (field.type === type) {
    return field;
  }
  const base = { id: field.id, label: field.label, required: field.required };
  switch (type) {
    case "text":
    case "textarea": {
      const ceiling =
        type === "text" ? USER_PAGE_LIMITS.formTextAnswerLength : USER_PAGE_LIMITS.formTextareaAnswerLength;
      const previous = field.type === "text" || field.type === "textarea" ? field.maxLength : ceiling;
      return { ...base, type, maxLength: Math.min(previous, ceiling) };
    }
    case "select":
      return { ...base, type, options: [] };
    case "checkbox":
      return { ...base, type };
  }
}

/** A whole-number field's value as typed; anything that is not a number becomes 0, which the checks refuse. */
export function parseWholeNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** `items` with the item at `from` moved one place up (-1) or down (1); unchanged at either end. */
export function nudge<Item>(items: readonly Item[], from: number, by: -1 | 1): Item[] {
  const to = from + by;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function replaceAt<Item>(items: readonly Item[], index: number, item: Item): Item[] {
  return items.map((existing, at) => (at === index ? item : existing));
}

export function removeAt<Item>(items: readonly Item[], index: number): Item[] {
  return items.filter((_, at) => at !== index);
}

/** A line saying what a collapsed widget holds, so the section reads at a glance; empty when there is nothing to say. */
export function widgetSummary(widget: PageWidget): string {
  switch (widget.type) {
    case "text":
      return widget.config.markdown.trim().split("\n")[0] ?? "";
    case "counter":
    case "timer":
      return widget.config.label ?? (widget.config.resource === "" ? "Not chosen yet" : "");
    case "live-status":
      return "";
    case "links":
      return plural(widget.config.links.length, "link");
    case "image":
      return widget.config.alt;
    case "form":
      return widget.config.title ?? plural(widget.config.fields.length, "question");
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
