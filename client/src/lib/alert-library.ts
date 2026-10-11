import type { Doc } from "@convex/_generated/dataModel";
import type { ActionStep, CompositionLinkInfo } from "@woofx3/api";
import { CONFIG_FIELD_TYPES, type ConfigField, type ConfigFieldType } from "@woofx3/api/ui-schema";
import {
  bindInputs,
  type CompositionDocument,
  type InputField,
  inputReferences,
  isPlainObject,
  normalizeComposition,
} from "@woofx3/scene/model";
import { compositionOfLegacyAlert, DEFAULT_ALERT_CANVAS, legacyAlertLayoutOf } from "@/lib/alert-layout";
import { commandStepId } from "@/lib/command-drafts";
import { unescapeDollarKeys } from "@/lib/dollar-keys";
import { projectWorkflow } from "@/lib/trigger-projection";
import type { VariableOption } from "@/lib/workflow-variables";

/**
 * The alert library: alerts the engine stores (capability
 * `compositions.alerts`) that an alert step plays by id (capability
 * `alerts.compositions`) instead of carrying a layout of its own.
 *
 * A step holds exactly one of the two (woofx3 docs/workflow/tasks.md, alert):
 * `{ target, layout }` for an alert written into the step, or
 * `{ target, composition, inputs }` for one linked from the library. A linked
 * step always plays the alert's latest published version, with `inputs`
 * filling in what the alert declares; `${...}` in an input is resolved by the
 * workflow before the alert is played.
 */

/** An alert step's parameters, as both surfaces that own one store them. */
export type AlertStepParams = Record<string, unknown>;

/** The library alert a step links, or null for a step with its own layout. */
export function linkedCompositionId(params: AlertStepParams | undefined): string | null {
  const composition = params?.composition;
  return typeof composition === "string" && composition !== "" ? composition : null;
}

/** A linked step's input values, by input id. */
export function linkedInputValues(params: AlertStepParams | undefined): Record<string, unknown> {
  return isPlainObject(params?.inputs) ? params.inputs : {};
}

/**
 * The step linked to a library alert: its layout gives way to the alert's
 * id and the values for its inputs. Every other parameter (the target) stays.
 */
export function linkedAlertParams(
  params: AlertStepParams,
  compositionId: string,
  inputs: Record<string, unknown> = {}
): AlertStepParams {
  if (compositionId === "") {
    throw new Error("linkedAlertParams: no composition id");
  }
  const { layout: _layout, composition: _composition, inputs: _inputs, ...rest } = params;
  return { ...rest, composition: compositionId, inputs };
}

/** The step holding `layout` itself, with no link to the library. Every other parameter stays. */
export function inlineAlertParams(params: AlertStepParams, layout: unknown): AlertStepParams {
  const { layout: _layout, composition: _composition, inputs: _inputs, ...rest } = params;
  return { ...rest, layout };
}

/**
 * The cached parts of a library alert that make up its document. Convex
 * stores them with `$`-prefixed keys (an input reference's `$input`)
 * escaped; see lib/dollar-keys.ts.
 */
export type LibraryAlertDocument = Pick<Doc<"alertCompositions">, "widgets" | "layout" | "behaviors" | "inputs">;

/** A library alert's declared inputs as the engine holds them. */
export function libraryAlertInputs(row: Pick<LibraryAlertDocument, "inputs">): unknown[] {
  return unescapeDollarKeys(row.inputs) as unknown[];
}

/**
 * A library alert's published document. The engine stores placements as a
 * list, bottom of the stack first, exactly as a list-shaped step layout holds
 * them, so the same conversion reads both.
 */
export function compositionOfLibraryAlert(row: LibraryAlertDocument): CompositionDocument {
  const layout = unescapeDollarKeys(isPlainObject(row.layout) ? row.layout : {}) as Record<string, unknown>;
  const { doc } = compositionOfLegacyAlert({
    width: DEFAULT_ALERT_CANVAS.width,
    height: DEFAULT_ALERT_CANVAS.height,
    ...layout,
    widgets: unescapeDollarKeys(row.widgets) as unknown[],
  });
  const behaviors = normalizeComposition({ ...doc, behaviors: unescapeDollarKeys(row.behaviors) })?.behaviors ?? {};
  return { ...doc, behaviors };
}

/**
 * A library alert copied into one step: its published document with every
 * input reference filled in, so the copy refers to no inputs and declares
 * none. Each input takes, in order:
 *
 * - the step's value for it (`values`), which may itself hold `${...}`: the
 *   workflow resolves that in a step's layout as it does in inputs;
 * - the input's declared default;
 * - the variable in `available` the input is named after, which is the one it
 *   replaced when the alert was saved from a step (see libraryAlertOfStep);
 * - otherwise `{id}` as plain text, so the place the value went stays visible
 *   and the text field offers to fill it. Those inputs are named in `unfilled`.
 *
 * A reference to an input the alert does not declare is filled the same way,
 * since the copy cannot keep a reference nothing fills. A document holding a
 * malformed reference is copied as it is.
 */
export function inlineCopyOfLibraryAlert(
  row: LibraryAlertDocument,
  values: Readonly<Record<string, unknown>> = {},
  available: readonly VariableOption[] = []
): { doc: CompositionDocument; unfilled: string[] } {
  const published = compositionOfLibraryAlert(row);
  const declared = new Map<string, Record<string, unknown>>();
  for (const input of libraryAlertInputs(row)) {
    if (isPlainObject(input) && typeof input.id === "string" && input.id !== "" && !declared.has(input.id)) {
      declared.set(input.id, input);
    }
  }
  const referenced = inputReferences({ ...published, inputs: [] }).map((usage) => usage.input);
  const ids = Array.from(new Set([...declared.keys(), ...referenced]));

  const filled: Record<string, unknown> = {};
  const unfilled: string[] = [];
  for (const id of ids) {
    const value = values[id];
    const defaultValue = declared.get(id)?.defaultValue;
    const named = variableNamedAfter(id, available);
    if (value !== undefined && value !== "") {
      filled[id] = value;
    } else if (defaultValue !== undefined) {
      filled[id] = defaultValue;
    } else if (named !== undefined) {
      filled[id] = named;
    } else {
      filled[id] = `{${id}}`;
      unfilled.push(id);
    }
  }
  const inputs = ids.map((id) => ({ id, label: id, type: "text" }));
  const bound = bindInputs({ ...published, inputs }, filled);
  return { doc: withoutInputs(bound.ok ? bound.document : published), unfilled: bound.ok ? unfilled : [] };
}

/** What a copy says about the inputs it left as `{id}` placeholders. */
export function unfilledInputsText(unfilled: readonly string[]): string {
  const names = unfilled.map((id) => `{${id}}`).join(", ");
  const verb = unfilled.length === 1 ? "is" : "are";
  return `${names} ${verb} left in this copy where the value goes. Insert a variable there, or type the text.`;
}

/** The reference of the first variable whose path ends in `id`, as libraryAlertOfStep names an input. */
function variableNamedAfter(id: string, available: readonly VariableOption[]): string | undefined {
  return available.find((option) => option.value.slice(2, -1).trim().split(/[.:]/).pop() === id)?.value;
}

function withoutInputs(doc: CompositionDocument): CompositionDocument {
  const { inputs: _inputs, base: _base, ...rest } = doc;
  return rest;
}

/**
 * What `alertCompositionActions.create` takes for a document: the shapes the
 * engine stores (see `storedSceneOf` in woofx3 sceneManager scene-documents.ts).
 */
export function libraryJsonOf(doc: CompositionDocument): {
  widgetsJson: string;
  layoutJson: string;
  behaviorsJson: string;
  inputsJson: string;
} {
  return {
    widgetsJson: JSON.stringify(legacyAlertLayoutOf(doc).widgets),
    layoutJson: JSON.stringify(doc.layout),
    behaviorsJson: JSON.stringify(doc.behaviors),
    inputsJson: JSON.stringify(doc.inputs ?? []),
  };
}

/**
 * A step's own alert made ready for the library, which plays a document
 * that refers only to its inputs (the workflow resolves `${...}` in a step's
 * parameters, never inside a stored alert). Each distinct `${...}` in the
 * canvas, widget settings and behavior params becomes an input, and
 * `values` fills each in with the reference it replaced, so the step that
 * links the saved alert plays what it played before. A string that is one
 * reference becomes `{ "$input": id }` and keeps the value's type; a
 * reference inside text becomes `{{id}}`, and a literal `{{` already there
 * is escaped as `\{{`.
 */
export function libraryAlertOfStep(
  doc: CompositionDocument,
  available: readonly VariableOption[]
): { doc: CompositionDocument; values: Record<string, string> } {
  const idByReference = new Map<string, string>();
  const inputs: InputField[] = [];
  const values: Record<string, string> = {};
  const inputFor = (reference: string): string => {
    const known = idByReference.get(reference);
    if (known !== undefined) {
      return known;
    }
    const inner = reference.slice(2, -1).trim();
    const base = (inner.split(/[.:]/).pop() ?? "").replace(/[^A-Za-z0-9_-]/g, "_") || "input";
    let id = base;
    for (let n = 2; inputs.some((input) => input.id === id); n += 1) {
      id = `${base}_${n}`;
    }
    const option = available.find((candidate) => candidate.value === reference);
    inputs.push({ id, label: option?.label ?? id, type: option?.type === "number" ? "number" : "text" });
    idByReference.set(reference, id);
    values[id] = reference;
    return id;
  };
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string") {
      const whole = value.match(/^\$\{[^{}]*\}$/);
      if (whole) {
        return { $input: inputFor(value) };
      }
      return value
        .split(/(\$\{[^{}]*\})/)
        .map((part) => (/^\$\{[^{}]*\}$/.test(part) ? `{{${inputFor(part)}}}` : part.replaceAll("{{", "\\{{")))
        .join("");
    }
    if (Array.isArray(value)) {
      return value.map(rewrite);
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]));
    }
    return value;
  };
  const widgets: CompositionDocument["widgets"] = {};
  for (const [id, placement] of Object.entries(doc.widgets)) {
    widgets[id] = { ...placement, settings: rewrite(placement.settings) as Record<string, unknown> };
  }
  const behaviors: CompositionDocument["behaviors"] = {};
  for (const [id, behavior] of Object.entries(doc.behaviors)) {
    behaviors[id] = { ...behavior, params: rewrite(behavior.params) as typeof behavior.params };
  }
  const layout = rewrite(doc.layout) as Record<string, unknown>;
  return { doc: { ...doc, layout, widgets, behaviors, inputs }, values };
}

/**
 * Types an input cannot take: a layout would put an alert inside an alert,
 * and a button collects no value.
 */
const NO_INPUT_TYPES: ReadonlySet<ConfigFieldType> = new Set(["layout", "button"]);

/**
 * The form a linked step fills in for an alert's inputs. An input is a
 * ConfigField already; this only makes sure each can be drawn, giving a
 * missing label the id and a type the form does not know `text`, which takes
 * any value and a variable. An input whose type cannot be an input is left
 * out; the engine plays it with its default.
 */
export function inputFieldsOf(inputs: readonly unknown[]): ConfigField[] {
  const known: ReadonlySet<string> = new Set(CONFIG_FIELD_TYPES);
  const fields: ConfigField[] = [];
  for (const raw of inputs) {
    if (!isPlainObject(raw) || typeof raw.id !== "string" || raw.id === "") {
      continue;
    }
    const type = typeof raw.type === "string" && known.has(raw.type) ? (raw.type as ConfigFieldType) : "text";
    if (NO_INPUT_TYPES.has(type)) {
      continue;
    }
    const label = typeof raw.label === "string" && raw.label !== "" ? raw.label : raw.id;
    fields.push({ ...(raw as unknown as ConfigField), id: raw.id, label, type });
  }
  return fields;
}

/**
 * A library alert's inputs as the variables its text fields offer: each is
 * referred to inside text as `{{id}}` (see variable-display.ts).
 */
export function inputVariableOptions(inputs: readonly unknown[]): VariableOption[] {
  return inputFieldsOf(inputs).map((field) => ({
    value: `{{${field.id}}}`,
    label: field.label,
    group: "Alert inputs",
    type: field.type === "number" ? "number" : "string",
    description: field.description,
  }));
}

const REFERENCE = /\$\{([^{}]*)\}/g;
/** A plain path: what the workflow reads from its own data, as opposed to an expression or an asset. */
const VARIABLE_PATH = /^[A-Za-z_][\w-]*(\.[\w-]+)+$/;

/**
 * The `${...}` variable references in `value` (searched through objects and
 * arrays) that none of `available` provides. A reference to an object above
 * an available variable (`${trigger.data.user}` beside
 * `${trigger.data.user.name}`) is provided. Anything that is not a plain
 * path, such as `${asset:...}` or an expression, is not judged.
 */
export function unprovidedVariables(value: unknown, available: readonly VariableOption[]): string[] {
  const paths = available.map((option) => option.value.slice(2, -1));
  const provided = (path: string) => paths.some((candidate) => candidate === path || candidate.startsWith(`${path}.`));
  const missing = new Set<string>();
  const visit = (current: unknown) => {
    if (typeof current === "string") {
      for (const match of current.matchAll(REFERENCE)) {
        const path = (match[1] ?? "").trim();
        if (VARIABLE_PATH.test(path) && !provided(path)) {
          missing.add(match[0]);
        }
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (isPlainObject(current)) {
      Object.values(current).forEach(visit);
    }
  };
  visit(value);
  return Array.from(missing);
}

export interface InputVariableWarning {
  inputId: string;
  label: string;
  /** The references, as stored, that the step's trigger does not provide. */
  references: string[];
}

/**
 * The inputs of a linked step whose value refers to a variable the step's
 * trigger (and the steps before it) does not provide. Such an input resolves
 * to nothing when the alert plays.
 */
export function inputVariableWarnings(
  fields: readonly ConfigField[],
  values: Record<string, unknown>,
  available: readonly VariableOption[]
): InputVariableWarning[] {
  const warnings: InputVariableWarning[] = [];
  for (const field of fields) {
    const references = unprovidedVariables(values[field.id], available);
    if (references.length > 0) {
      warnings.push({ inputId: field.id, label: field.label, references });
    }
  }
  return warnings;
}

/** The names the dashboard knows a link's owner by: workflow names by engine id, command words by engine id. */
export interface LinkOwnerNames {
  workflows: ReadonlyMap<string, string>;
  commands: ReadonlyMap<string, string>;
  /** Each owner's step numbers as its editor shows them, by `linkOwnerKey` and then step id. */
  stepNumbers: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** The key `LinkOwnerNames.stepNumbers` holds an owner's steps under. */
export function linkOwnerKey(kind: CompositionLinkInfo["ownerKind"], ownerId: string): string {
  return `${kind}:${ownerId}`;
}

/**
 * A workflow's step numbers as the editors show them: on the Alerts screen an
 * action is numbered by its place among its trigger's actions ("Step 2"), so a
 * workflow that screen can show is numbered that way. Any other workflow, or
 * an action shared by several triggers, is numbered by its place in the
 * workflow's tasks.
 */
export function workflowStepNumbers(row: Doc<"workflows">): Map<string, number> {
  const numbers = new Map<string, number>();
  const tasks = (row.definition as { tasks?: unknown } | undefined)?.tasks;
  if (Array.isArray(tasks)) {
    tasks.forEach((task, index) => {
      if (isPlainObject(task) && typeof task.id === "string") {
        numbers.set(task.id, index + 1);
      }
    });
  }
  const projected = projectWorkflow(row);
  if (projected.ok) {
    for (const trigger of projected.projection.triggers) {
      trigger.actions.forEach((action, index) => {
        numbers.set(action.id, index + 1);
      });
    }
  }
  return numbers;
}

/** A command's step numbers, as its editor shows them ("Step 2"). */
export function commandStepNumbers(actions: readonly ActionStep[]): Map<string, number> {
  return new Map(actions.map((action, index) => [commandStepId(action, index), index + 1]));
}

function linkOwnerName(link: CompositionLinkInfo, names: LinkOwnerNames): string {
  if (link.ownerKind === "command") {
    const command = names.commands.get(link.ownerId);
    return command ? `!${command}` : "A chat command";
  }
  return names.workflows.get(link.ownerId) ?? "A trigger";
}

/** One line per step that links an alert, for saying where it is used. */
export function describeLinks(links: readonly CompositionLinkInfo[], names: LinkOwnerNames): string[] {
  return links.map((link) => {
    const owner = linkOwnerName(link, names);
    // A step id is the engine's own (`act_1`), which no screen shows, so a step the
    // dashboard cannot number is named by its owner alone.
    const number = names.stepNumbers.get(linkOwnerKey(link.ownerKind, link.ownerId))?.get(link.stepId);
    return number === undefined ? owner : `${owner} · step ${number}`;
  });
}
