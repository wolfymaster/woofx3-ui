import type { Doc } from "@convex/_generated/dataModel";
import { randomNodeId } from "@woofx3/scene/editor";
import {
  type BehaviorDocument,
  bindInputs,
  type CompositionDocument,
  type InputField,
  inputReferences,
  isPlainObject,
  keysBetween,
  type NodeId,
  normalizeComposition,
  type PlacementDocument,
  stackOrder,
} from "@woofx3/scene/model";
import { compositionOfLegacyAlert, DEFAULT_ALERT_CANVAS, legacyAlertLayoutOf } from "@/lib/alert-layout";
import { unescapeDollarKeys } from "@/lib/dollar-keys";
import type { VariableOption } from "@/lib/workflow-variables";

/**
 * The alert library: alerts the engine stores (capability
 * `compositions.alerts`) as starting points. A step never plays one by id:
 * starting from a library alert copies it into the step's own `layout`, and
 * saving a step's alert to the library stores a copy. A library alert is
 * edited on its own page, which changes only the copies made after.
 *
 * A stored alert refers to no event data of its own, since it belongs to no
 * trigger. What it shows from the event goes through its inputs: `{{id}}`
 * inside text, or `{ "$input": id }` as a whole value. A copy fills each
 * input with the step's variable of the same name.
 */

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
 * A library alert's published document, declaring its inputs. The engine
 * stores placements as a list, bottom of the stack first, exactly as a
 * list-shaped step layout holds them, so the same conversion reads both.
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
  return { ...doc, behaviors, inputs: declaredInputsOf(row) };
}

/**
 * A library alert's declared inputs, each id once and the first declaration
 * of it kept. The cached row is whatever the engine reported, and binding
 * refuses an input without an id or one declared twice.
 */
export function declaredInputsOf(row: Pick<LibraryAlertDocument, "inputs">): InputField[] {
  const declared = new Map<string, InputField>();
  for (const input of libraryAlertInputs(row)) {
    if (isPlainObject(input) && typeof input.id === "string" && input.id !== "" && !declared.has(input.id)) {
      declared.set(input.id, input as unknown as InputField);
    }
  }
  return Array.from(declared.values());
}

/**
 * A library alert copied into one step: its published document with every
 * input reference filled in, so the copy refers to no inputs and declares
 * none. Each input takes, in order:
 *
 * - the variable in `available` the input is named after, which is the one it
 *   replaced when the alert was saved from a step (see libraryAlertOfStep);
 * - the input's declared default;
 * - otherwise `{id}` as plain text, so the place the value went stays visible
 *   and the text field offers to fill it. Those inputs are named in `unfilled`.
 *
 * A reference to an input the alert does not declare is filled the same way,
 * since the copy cannot keep a reference nothing fills. A document holding a
 * malformed reference is copied as it is.
 */
export function inlineCopyOfLibraryAlert(
  row: LibraryAlertDocument,
  available: readonly VariableOption[]
): { doc: CompositionDocument; unfilled: string[] } {
  const published = compositionOfLibraryAlert(row);
  const declared = new Map(declaredInputsOf(row).map((input) => [input.id, input]));
  const referenced = inputReferences({ ...published, inputs: [] }).map((usage) => usage.input);
  const ids = Array.from(new Set([...declared.keys(), ...referenced]));

  const filled: Record<string, unknown> = {};
  const unfilled: string[] = [];
  for (const id of ids) {
    const named = variableNamedAfter(id, available);
    const defaultValue = declared.get(id)?.defaultValue;
    if (named !== undefined) {
      filled[id] = named;
    } else if (defaultValue !== undefined) {
      filled[id] = defaultValue;
    } else {
      filled[id] = `{${id}}`;
      unfilled.push(id);
    }
  }
  const inputs = ids.map((id) => ({ id, label: id, type: "text" }));
  const bound = bindInputs({ ...published, inputs }, filled);
  return { doc: withoutInputs(bound.ok ? bound.document : published), unfilled: bound.ok ? unfilled : [] };
}

/**
 * `current` with every layer of `copy` added on top of its stack, as the library tab adds a
 * library alert to the canvas. The copied layers and their behaviors take fresh ids, so the
 * alert can be added more than once, and the canvas keeps its own size and background.
 */
export function withLayersOf(current: CompositionDocument, copy: CompositionDocument): CompositionDocument {
  const takenNodes = new Set(Object.keys(current.widgets));
  const idMap = new Map<NodeId, NodeId>();
  for (const id of stackOrder(copy)) {
    const fresh = randomNodeId(takenNodes);
    takenNodes.add(fresh);
    idMap.set(id, fresh);
  }

  const order = stackOrder(current);
  const topId = order[order.length - 1];
  const top = topId === undefined ? null : (current.widgets[topId] as PlacementDocument).z;
  const keys = keysBetween(top, null, idMap.size);
  const widgets = { ...current.widgets };
  Array.from(idMap.entries()).forEach(([from, to], i) => {
    widgets[to] = { ...structuredClone(copy.widgets[from] as PlacementDocument), z: keys[i] as string };
  });

  const behaviors = { ...current.behaviors };
  const takenBehaviors = new Set(Object.keys(behaviors));
  for (const behavior of Object.values(copy.behaviors)) {
    const target = idMap.get(behavior.target);
    if (target === undefined) {
      // A behavior on the copy's canvas belongs to that alert as a whole, not to its layers.
      continue;
    }
    const id = `b-${randomNodeId(takenBehaviors).slice(2)}`;
    takenBehaviors.add(id);
    const timing = { ...behavior.timing };
    if (timing.node !== undefined) {
      timing.node = idMap.get(timing.node) ?? timing.node;
    }
    behaviors[id] = { ...(structuredClone(behavior) as BehaviorDocument), target, timing };
  }
  return { ...current, widgets, behaviors };
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
 * A step's own alert made ready for the library, which belongs to no trigger
 * and so refers to no event data directly. Each distinct `${...}` in the
 * canvas, widget settings and behavior params becomes an input named after
 * the variable's last path segment, which is how a copy finds the variable
 * again (inlineCopyOfLibraryAlert). A string that is one reference becomes
 * `{ "$input": id }` and keeps the value's type; a reference inside text
 * becomes `{{id}}`, and a literal `{{` already there is escaped as `\{{`.
 */
export function libraryAlertOfStep(
  doc: CompositionDocument,
  available: readonly VariableOption[]
): CompositionDocument {
  const idByReference = new Map<string, string>();
  const inputs: InputField[] = [];
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
  return { ...doc, layout, widgets, behaviors, inputs };
}

/**
 * A library alert's inputs as the variables its own editor's text fields
 * offer: each is referred to inside text as `{{id}}` (see variable-display.ts).
 */
export function inputVariableOptions(inputs: readonly InputField[]): VariableOption[] {
  return inputs.map((input) => {
    const label = typeof input.label === "string" && input.label !== "" ? input.label : input.id;
    return {
      value: `{{${input.id}}}`,
      label,
      group: "Alert inputs",
      type: input.type === "number" ? "number" : "string",
      description: typeof input.description === "string" ? input.description : undefined,
    };
  });
}

/**
 * What a library alert's editor previews its inputs with: each input's
 * default, or its `{id}` as text where it has none, so the preview shows
 * where the value goes rather than refusing to play.
 */
export function libraryPreviewInputs(inputs: readonly InputField[]): Record<string, unknown> {
  return Object.fromEntries(
    inputs.map((input) => [input.id, input.defaultValue !== undefined ? input.defaultValue : `{${input.id}}`])
  );
}
