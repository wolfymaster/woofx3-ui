import { COUNTER_KIND, FORM_KIND, TIMER_KIND } from "@shared/resource-kinds";
import { type Infer, type Validator, v } from "convex/values";
import { checkFormFieldId, checkId, checkImage, checkLinkUrl, checkUniqueIds, pageImageValidator } from "./fields";
import { hasUndeliverableText } from "./forms";
import { USER_PAGE_LIMITS } from "./limits";
import { type PageProblem, ProblemReport } from "./problems";

/**
 * First-party page widgets, keyed by a stable type id that is stored in every
 * page revision, so an id is never renamed or reused. Each entry owns its
 * config's shape (a Convex validator, so the schema and the save mutation
 * accept exactly that shape), the rules a shape cannot express, and the engine
 * resources it binds. Convex validates saves with it and the editor and
 * renderer read it, so the two cannot disagree about what a widget holds.
 */

/** The resource kinds a widget can bind, as `{module}:{kind}`. */
export const BINDABLE_RESOURCE_KINDS = [COUNTER_KIND, TIMER_KIND, FORM_KIND] as const;
export type BindableResourceKind = (typeof BINDABLE_RESOURCE_KINDS)[number];
export const bindableResourceKindValidator = v.union(
  v.literal(COUNTER_KIND),
  v.literal(TIMER_KIND),
  v.literal(FORM_KIND)
);

/** An engine resource a widget shows the value of, by the canonical id `{module}:{kind}:{id}`. */
export interface ResourceBinding {
  canonicalId: string;
  kind: BindableResourceKind;
}

export interface PageWidgetDefinition<Type extends string, Config> {
  type: Type;
  label: string;
  description: string;
  configValidator: Validator<Config, "required", string>;
  // Config is inferred from configValidator alone; the rest must fit it.
  /** The config a newly added widget starts with. */
  defaultConfig: () => NoInfer<Config>;
  /** Reports what the shape alone cannot: lengths, URLs, unique ids. */
  check: (config: NoInfer<Config>, report: ProblemReport) => void;
  bindings: (config: NoInfer<Config>) => ResourceBinding[];
}

function defineWidget<Type extends string, Config>(
  definition: PageWidgetDefinition<Type, Config>
): PageWidgetDefinition<Type, Config> {
  return definition;
}

const noBindings = (): ResourceBinding[] => [];

function checkLabel(label: string | undefined, report: ProblemReport): void {
  if (label !== undefined) {
    report.field("label").text(label, "Label", USER_PAGE_LIMITS.labelLength);
  }
}

function checkResource(canonicalId: string, report: ProblemReport): void {
  if (canonicalId.trim() === "") {
    report.field("resource").add("Choose what this widget shows");
  }
}

export const TEXT_WIDGET = defineWidget({
  type: "text",
  label: "Text",
  description: "Formatted text written in Markdown.",
  configValidator: v.object({ markdown: v.string() }),
  defaultConfig: () => ({ markdown: "" }),
  check: (config, report) => {
    report.field("markdown").text(config.markdown, "Text", USER_PAGE_LIMITS.textLength);
  },
  bindings: noBindings,
});

export const COUNTER_WIDGET = defineWidget({
  type: "counter",
  label: "Counter",
  description: "The live value of one of your counters, with its goals if it has any.",
  configValidator: v.object({ resource: v.string(), label: v.optional(v.string()), showGoals: v.boolean() }),
  defaultConfig: () => ({ resource: "", showGoals: true }),
  check: (config, report) => {
    checkResource(config.resource, report);
    checkLabel(config.label, report);
  },
  bindings: (config) => [{ canonicalId: config.resource, kind: COUNTER_KIND }],
});

export const TIMER_WIDGET = defineWidget({
  type: "timer",
  label: "Timer",
  description: "One of your timers counting down live.",
  configValidator: v.object({ resource: v.string(), label: v.optional(v.string()) }),
  defaultConfig: () => ({ resource: "" }),
  check: (config, report) => {
    checkResource(config.resource, report);
    checkLabel(config.label, report);
  },
  bindings: (config) => [{ canonicalId: config.resource, kind: TIMER_KIND }],
});

export const LIVE_STATUS_WIDGET = defineWidget({
  type: "live-status",
  label: "Live status",
  description: "Whether you are live right now, and what you are streaming.",
  configValidator: v.object({ showTitle: v.boolean(), showGame: v.boolean(), showViewerCount: v.boolean() }),
  defaultConfig: () => ({ showTitle: true, showGame: true, showViewerCount: false }),
  check: () => {},
  bindings: noBindings,
});

export const LINKS_WIDGET = defineWidget({
  type: "links",
  label: "Links",
  description: "A list of links to your other places.",
  configValidator: v.object({ links: v.array(v.object({ label: v.string(), url: v.string() })) }),
  defaultConfig: () => ({ links: [] }),
  check: (config, report) => {
    const links = report.field("links");
    links.count(config.links.length, "links", USER_PAGE_LIMITS.links);
    config.links.forEach((link, index) => {
      const item = links.item(index);
      item.field("label").text(link.label, "Label", USER_PAGE_LIMITS.labelLength, true);
      checkLinkUrl(link.url, item.field("url"));
    });
  },
  bindings: noBindings,
});

export const IMAGE_WIDGET = defineWidget({
  type: "image",
  label: "Image",
  description: "A picture, optionally linking somewhere.",
  configValidator: v.object({ image: pageImageValidator, alt: v.string(), linkUrl: v.optional(v.string()) }),
  defaultConfig: () => ({ image: { kind: "url" as const, url: "" }, alt: "" }),
  check: (config, report) => {
    checkImage(config.image, report.field("image"));
    report.field("alt").text(config.alt, "Description", USER_PAGE_LIMITS.imageAltLength);
    if (config.linkUrl !== undefined) {
      checkLinkUrl(config.linkUrl, report.field("linkUrl"));
    }
  },
  bindings: noBindings,
});

const formFieldBase = { id: v.string(), label: v.string(), required: v.boolean() };

/**
 * One question on a form. Text answers carry their own maximum length, which
 * a submission is held to (forms.ts); it can be set no higher than the
 * per-type ceiling in USER_PAGE_LIMITS.
 */
export const formFieldValidator = v.union(
  v.object({ ...formFieldBase, type: v.literal("text"), maxLength: v.number() }),
  v.object({ ...formFieldBase, type: v.literal("textarea"), maxLength: v.number() }),
  v.object({
    ...formFieldBase,
    type: v.literal("select"),
    options: v.array(v.object({ value: v.string(), label: v.string() })),
  }),
  v.object({ ...formFieldBase, type: v.literal("checkbox") })
);

export type FormField = Infer<typeof formFieldValidator>;
export type FormFieldType = FormField["type"];
export const formFieldTypeValidator = v.union(
  v.literal("text"),
  v.literal("textarea"),
  v.literal("select"),
  v.literal("checkbox")
);

const FORM_ANSWER_CEILING: Record<"text" | "textarea", number> = {
  text: USER_PAGE_LIMITS.formTextAnswerLength,
  textarea: USER_PAGE_LIMITS.formTextareaAnswerLength,
};

/** Text a submission carries to the engine, which refuses characters its database can't store. */
function checkFormText(text: string, label: string, report: ProblemReport, required = false): void {
  report.text(text, label, USER_PAGE_LIMITS.labelLength, required);
  if (hasUndeliverableText(text)) {
    report.add(`${label} has a character that can't be saved`);
  }
}

function checkFormField(field: FormField, report: ProblemReport): void {
  checkFormFieldId(field.id, report.field("id"));
  checkFormText(field.label, "Question", report.field("label"), true);
  switch (field.type) {
    case "text":
    case "textarea": {
      const ceiling = FORM_ANSWER_CEILING[field.type];
      if (!Number.isSafeInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > ceiling) {
        report.field("maxLength").add(`Longest answer must be a whole number from 1 to ${ceiling}`);
      }
      return;
    }
    case "select": {
      const options = report.field("options");
      if (field.options.length === 0) {
        options.add("A choice needs at least one option");
      }
      options.count(field.options.length, "options", USER_PAGE_LIMITS.formSelectOptions);
      field.options.forEach((option, index) => {
        const item = options.item(index);
        checkFormText(option.value, "Value", item.field("value"), true);
        item.field("label").text(option.label, "Option", USER_PAGE_LIMITS.labelLength, true);
      });
      const values = field.options.map((option) => option.value);
      if (new Set(values).size !== values.length) {
        options.add("Two options have the same value");
      }
      return;
    }
    case "checkbox":
      return;
  }
}

/**
 * What a `woofx3:form` instance holds in its settings. The engine keeps those
 * opaque, so every reader goes through parseFormDefinition.
 */
export interface FormDefinition {
  title?: string;
  submitLabel: string;
  fields: FormField[];
}

export function checkFormDefinition(definition: FormDefinition, report: ProblemReport): void {
  if (definition.title !== undefined) {
    checkFormText(definition.title, "Title", report.field("title"));
  }
  report.field("submitLabel").text(definition.submitLabel, "Button text", USER_PAGE_LIMITS.labelLength, true);
  checkFormQuestions(definition.fields, report.field("fields"));
}

/** The rules for a form's questions; `report` sits at the list itself. */
export function checkFormQuestions(questions: readonly FormField[], report: ProblemReport): void {
  report.count(questions.length, "questions", USER_PAGE_LIMITS.formFields);
  questions.forEach((field, index) => {
    checkFormField(field, report.item(index));
  });
  checkUniqueIds(
    questions.map((field) => field.id),
    report
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseFormField(raw: unknown): FormField | null {
  const field = asRecord(raw);
  if (
    !field ||
    typeof field.id !== "string" ||
    typeof field.label !== "string" ||
    typeof field.required !== "boolean"
  ) {
    return null;
  }
  const base = { id: field.id, label: field.label, required: field.required };
  switch (field.type) {
    case "text":
    case "textarea":
      return typeof field.maxLength === "number" ? { ...base, type: field.type, maxLength: field.maxLength } : null;
    case "select": {
      if (!Array.isArray(field.options)) {
        return null;
      }
      const options = field.options.flatMap((option: unknown) => {
        const entry = asRecord(option);
        return entry && typeof entry.value === "string" && typeof entry.label === "string"
          ? [{ value: entry.value, label: entry.label }]
          : [];
      });
      return options.length === field.options.length ? { ...base, type: "select", options } : null;
    }
    case "checkbox":
      return { ...base, type: "checkbox" };
    default:
      return null;
  }
}

/** The questions in a form instance's `fields` setting; one that can't be read is left out. */
export function parseFormFields(raw: unknown): FormField[] {
  return Array.isArray(raw) ? raw.flatMap((field) => parseFormField(field) ?? []) : [];
}

/**
 * The form an instance's settings describe, or null when visitors can't be
 * shown one: it has no questions yet, or its settings break the rules. An empty
 * title is how the kind's text field says there is none.
 */
export function parseFormDefinition(settings: unknown): FormDefinition | null {
  const source = asRecord(settings);
  if (!source || typeof source.submitLabel !== "string" || !Array.isArray(source.fields)) {
    return null;
  }
  const fields = parseFormFields(source.fields);
  if (fields.length === 0 || fields.length !== source.fields.length) {
    return null;
  }
  const definition: FormDefinition = {
    ...(typeof source.title === "string" && source.title !== "" ? { title: source.title } : {}),
    submitLabel: source.submitLabel,
    fields,
  };
  const problems: PageProblem[] = [];
  checkFormDefinition(definition, ProblemReport.root(problems));
  return problems.length === 0 ? definition : null;
}

export const FORM_WIDGET = defineWidget({
  type: "form",
  label: "Form",
  description: "One of your forms, for visitors to answer.",
  configValidator: v.object({ resource: v.string() }),
  defaultConfig: () => ({ resource: "" }),
  check: (config, report) => {
    checkResource(config.resource, report);
  },
  bindings: (config) => [{ canonicalId: config.resource, kind: FORM_KIND }],
});

function placedWidget<Type extends string, Config>(definition: PageWidgetDefinition<Type, Config>) {
  return v.object({ id: v.string(), type: v.literal(definition.type), config: definition.configValidator });
}

/** A widget placed in a section: its id within the page, its type and that type's config. */
export const pageWidgetValidator = v.union(
  placedWidget(TEXT_WIDGET),
  placedWidget(COUNTER_WIDGET),
  placedWidget(TIMER_WIDGET),
  placedWidget(LIVE_STATUS_WIDGET),
  placedWidget(LINKS_WIDGET),
  placedWidget(IMAGE_WIDGET),
  placedWidget(FORM_WIDGET)
);

export type PageWidget = Infer<typeof pageWidgetValidator>;
export type PageWidgetType = PageWidget["type"];
export type PageWidgetConfig<Type extends PageWidgetType> = Extract<PageWidget, { type: Type }>["config"];

type PageWidgetRegistry = { [Type in PageWidgetType]: PageWidgetDefinition<Type, PageWidgetConfig<Type>> };

export const PAGE_WIDGETS: PageWidgetRegistry = {
  text: TEXT_WIDGET,
  counter: COUNTER_WIDGET,
  timer: TIMER_WIDGET,
  "live-status": LIVE_STATUS_WIDGET,
  links: LINKS_WIDGET,
  image: IMAGE_WIDGET,
  form: FORM_WIDGET,
};

export const PAGE_WIDGET_TYPES = Object.keys(PAGE_WIDGETS) as PageWidgetType[];

export function isPageWidgetType(type: string): type is PageWidgetType {
  return (PAGE_WIDGET_TYPES as string[]).includes(type);
}

/**
 * The definition for a placed widget, typed to its config. TypeScript cannot
 * correlate `PAGE_WIDGETS[widget.type]` with `widget.config` on its own, so the
 * one cast lives here; the registry's mapped type is what makes it sound.
 */
export function widgetDefinition<Widget extends PageWidget>(
  widget: Widget
): PageWidgetDefinition<Widget["type"], Widget["config"]> {
  return PAGE_WIDGETS[widget.type] as unknown as PageWidgetDefinition<Widget["type"], Widget["config"]>;
}

export function checkWidget(widget: PageWidget, report: ProblemReport): void {
  checkId(widget.id, report.field("id"));
  widgetDefinition(widget).check(widget.config, report.field("config"));
}

export function widgetBindings(widget: PageWidget): ResourceBinding[] {
  return widgetDefinition(widget).bindings(widget.config);
}
