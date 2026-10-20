import { bareKind, parseKindRef, resourceKindMatches } from "@convex/lib/resourceKinds";
import { Braces, Clock, Hourglass, type LucideIcon, MessageSquare, Puzzle, Radio, Split } from "lucide-react";
import { BUILTIN_MODULE_LABEL } from "@/lib/action-menu";
import { taxonomyLabel } from "@/lib/alert-groups";
import { STREAM_OBJECT_ICONS } from "@/lib/stream-object-icons";
import type { ActionPreset, ConfigField } from "@/lib/workflow-presets";

type SourceTarget = { type: "source"; source: "scenes" | "alertWidgets" };

/**
 * Which of the streamer's own things an object's actions act on: instances of
 * the resource kinds its actions' `resource_ref` fields name, or a field whose
 * options come from the streamer's scenes or alert widgets.
 */
export type ActionObjectTarget = { type: "resource"; kinds: readonly string[] } | SourceTarget;

/**
 * What an object definition says its actions act on. A resource object names
 * only what its things are called (`counter`), never a module's kind: the kinds
 * come from its actions' fields, so a module's own counter kind is listed
 * alongside the bundled one.
 */
type DefinitionTarget = { type: "resource"; kindName: string } | SourceTarget;

/** One of the streamer's things, as a "Which one?" chip offers it. */
export interface ObjectInstance {
  /** What the action's target field stores: a canonical id, an engine scene id, a widget name. */
  value: string;
  label: string;
  /** A resource instance's kind, qualified (`woofx3:counter`); absent for a scene or alert widget. */
  kind?: string;
}

/** A resource instance as Convex mirrors it (`moduleResourceInstances`). */
export interface ResourceInstanceRow {
  canonicalId: string;
  displayName: string;
  moduleName: string;
  /** The kind's own name, without its module. */
  kind: string;
}

/** An action listed under an object, and the setting a chosen instance fills. */
export interface ObjectAction {
  preset: ActionPreset;
  /** Absent when the action has no setting for the object's things. */
  targetField?: ConfigField;
  /**
   * The providing module's display name, present when another action of the same object
   * has the same name, so the two can be told apart.
   */
  qualifier?: string;
}

/** What the picker offers first: something that can change, and the actions that change it. */
export interface ActionObject {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Present when choosing an object asks "Which one?" before its verbs. */
  target?: ActionObjectTarget;
  /** What one of its things is called, for "Which counter?": lower case, singular. */
  noun?: string;
  /** Leads the list of its things under the object, when a bare list of names would not say what they are. */
  instancesLead?: string;
  /** Said in place of its things when the streamer has none. */
  noInstances?: string;
  actions: ObjectAction[];
}

interface ObjectDefinition {
  key: string;
  /** The taxonomy entry this object takes: the entry itself and anything under it. */
  taxonomy: string;
  label: string;
  icon: LucideIcon;
  target?: DefinitionTarget;
  noun?: string;
  instancesLead?: string;
  noInstances?: string;
}

/**
 * The objects the UI names itself, in the order the picker lists them. Anything a
 * catalog files elsewhere becomes a platform, a module's own object, or Advanced;
 * see actionObjectPlacement.
 */
const OBJECT_DEFINITIONS: readonly ObjectDefinition[] = [
  { key: "chat", taxonomy: "chat", label: "Chat", icon: MessageSquare },
  {
    key: "alerts",
    taxonomy: "overlay.alerts",
    label: "Alerts",
    icon: STREAM_OBJECT_ICONS.alerts,
    target: { type: "source", source: "alertWidgets" },
    // An alert's target is an alert widget, a named area of a scene. Streamers
    // think of it as where the alert shows up, so that is what the picker asks.
    noun: "spot on your overlay",
    instancesLead: "Plays on your overlay at",
    noInstances: "None of your overlays has a spot for alerts yet.",
  },
  {
    key: "scenes",
    taxonomy: "overlay.scenes",
    label: "Scenes",
    icon: STREAM_OBJECT_ICONS.scenes,
    target: { type: "source", source: "scenes" },
    noun: "scene",
  },
  {
    key: "counters",
    taxonomy: "tools.counter",
    label: "Counters",
    icon: STREAM_OBJECT_ICONS.counters,
    target: { type: "resource", kindName: "counter" },
    noun: "counter",
  },
  {
    key: "timers",
    taxonomy: "tools.timer",
    label: "Timers",
    icon: STREAM_OBJECT_ICONS.timers,
    target: { type: "resource", kindName: "timer" },
    noun: "timer",
  },
  {
    key: "queues",
    taxonomy: "tools.queue",
    label: "Queues",
    icon: STREAM_OBJECT_ICONS.queues,
    target: { type: "resource", kindName: "queue" },
    noun: "queue",
  },
];

export const ADVANCED_OBJECT_KEY = "advanced";
const ADVANCED_LABEL = "Advanced";
const PLATFORM_FAMILY = "platform";

interface ObjectPlacement {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Lower lists first. */
  rank: number;
  definition?: ObjectDefinition;
}

const PLATFORM_RANK = OBJECT_DEFINITIONS.length;
const MODULE_RANK = PLATFORM_RANK + 1;
const ADVANCED_RANK = MODULE_RANK + 1;

/**
 * The object an action is listed under, read from its first `taxonomy` entry like
 * the action menu's placement: an entry the definitions table names, else
 * `platform.<x>` as that platform, else Advanced. Advanced also takes `workflow`
 * (the primitives) and every family the table does not name, so nothing a catalog
 * sends goes unlisted.
 *
 * An action declaring no taxonomy (or a malformed first entry) is its module's own object, as the action menu
 * lists it under its module; a built-in one is Advanced, the menu's Built-in.
 */
function actionObjectPlacement(preset: Pick<ActionPreset, "source" | "taxonomy">): ObjectPlacement {
  const entry = firstTaxonomyEntry(preset.taxonomy);
  if (!entry) {
    if (preset.source === BUILTIN_MODULE_LABEL) {
      return advancedPlacement();
    }
    return { key: `module:${preset.source}`, label: preset.source, icon: Puzzle, rank: MODULE_RANK };
  }
  const index = OBJECT_DEFINITIONS.findIndex(
    (definition) => entry === definition.taxonomy || entry.startsWith(`${definition.taxonomy}.`)
  );
  if (index >= 0) {
    const definition = OBJECT_DEFINITIONS[index];
    return { key: definition.key, label: definition.label, icon: definition.icon, rank: index, definition };
  }
  const [family, platform] = entry.split(".");
  if (family === PLATFORM_FAMILY && platform) {
    return { key: `platform:${platform}`, label: taxonomyLabel(platform), icon: Radio, rank: PLATFORM_RANK };
  }
  return advancedPlacement();
}

/** The key of the object `preset` is listed under. */
export function actionObjectKey(preset: Pick<ActionPreset, "source" | "taxonomy">): string {
  return actionObjectPlacement(preset).key;
}

/**
 * The objects the catalog's actions fall under, each with its actions by name:
 * the named objects in table order, then platforms and modules by label, then
 * Advanced. An object with no actions is left out, since it would offer nothing.
 */
export function actionObjects(presets: readonly ActionPreset[]): ActionObject[] {
  const found = new Map<string, { placement: ObjectPlacement; actions: ObjectAction[] }>();
  for (const preset of presets) {
    const placement = actionObjectPlacement(preset);
    const target = placement.definition?.target;
    const targetField = target ? findTargetField(preset, target) : undefined;
    const action: ObjectAction = targetField ? { preset, targetField } : { preset };
    const entry = found.get(placement.key);
    if (entry) {
      entry.actions.push(action);
    } else {
      found.set(placement.key, { placement, actions: [action] });
    }
  }
  return Array.from(found.values())
    .sort((a, b) => a.placement.rank - b.placement.rank || a.placement.label.localeCompare(b.placement.label))
    .map(({ placement, actions }) => {
      const definition = placement.definition;
      const target = definition?.target ? objectTarget(definition.target, actions) : undefined;
      return {
        key: placement.key,
        label: placement.label,
        icon: placement.icon,
        ...(target ? { target } : {}),
        ...(definition?.noun ? { noun: definition.noun } : {}),
        ...(definition?.instancesLead ? { instancesLead: definition.instancesLead } : {}),
        ...(definition?.noInstances ? { noInstances: definition.noInstances } : {}),
        actions: qualifySharedNames(actions).sort(
          (a, b) => a.preset.name.localeCompare(b.preset.name) || (a.qualifier ?? "").localeCompare(b.qualifier ?? "")
        ),
      };
    });
}

/** Each action whose name another action of the object shares, given its module's name. */
function qualifySharedNames(actions: readonly ObjectAction[]): ObjectAction[] {
  const counts = new Map<string, number>();
  for (const action of actions) {
    const name = action.preset.name.trim().toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return actions.map((action) =>
    (counts.get(action.preset.name.trim().toLowerCase()) ?? 0) > 1
      ? { ...action, qualifier: action.preset.source }
      : action
  );
}

/**
 * The object's target as its actions declare it: for a resource object, every
 * kind its actions' target fields name, in the order first named. A resource
 * object none of whose actions names a kind has no things to choose from.
 */
function objectTarget(target: DefinitionTarget, actions: readonly ObjectAction[]): ActionObjectTarget | undefined {
  if (target.type === "source") {
    return target;
  }
  const kinds = new Set<string>();
  for (const action of actions) {
    const kind = action.targetField?.resourceKind;
    if (kind) {
      kinds.add(kind);
    }
  }
  return kinds.size > 0 ? { type: "resource", kinds: [...kinds] } : undefined;
}

/**
 * The setting a chosen thing fills: the first `resource_ref` field naming a
 * kind of the object's name (`counter`, from any module, or bare as a module
 * installed before kinds were qualified names it), or the first field whose
 * options come from the target's source.
 *
 * An action filed under a resource object whose one `resource_ref` names a kind
 * of another name (a module's `tally` filed under Counters) acts on that kind:
 * the module put it there, and the setting can hold nothing else.
 */
export function findTargetField(
  preset: Pick<ActionPreset, "config">,
  target: DefinitionTarget
): ConfigField | undefined {
  const fields = preset.config?.fields ?? [];
  if (target.type === "source") {
    return fields.find((field) => field.source?.kind === target.source);
  }
  const refs = fields.filter((field) => field.type === "resource_ref");
  const named = refs.find((field) => parseKindRef(field.resourceKind ?? "")?.kind === target.kindName);
  return named ?? (refs.length === 1 ? refs[0] : undefined);
}

/**
 * Whether `action` can be pointed at `instance`. A resource instance must be of
 * a kind the action's target field accepts, so an action of one module is never
 * handed another module's counter; a scene or alert widget fits any action of
 * its object that has a target field.
 */
export function acceptsInstance(action: ObjectAction, instance: ObjectInstance): boolean {
  const field = action.targetField;
  if (!field) {
    return false;
  }
  if (instance.kind === undefined) {
    return field.type !== "resource_ref";
  }
  return field.type === "resource_ref" && resourceKindMatches(field.resourceKind, instance.kind);
}

/**
 * The actions offered once `chosen` is picked: those that can be pointed at it, and
 * those that act on none of the object's things (making a new one), which fit any
 * choice. An action that can only take another kind of thing is left out.
 */
export function verbsFor(object: Pick<ActionObject, "actions">, chosen: ObjectInstance | undefined): ObjectAction[] {
  if (!chosen) {
    return object.actions;
  }
  return object.actions.filter((action) => !action.targetField || acceptsInstance(action, chosen));
}

/** The instances `action` can be pointed at, in the order given. */
export function instancesFor(action: ObjectAction, instances: readonly ObjectInstance[]): ObjectInstance[] {
  return instances.filter((instance) => acceptsInstance(action, instance));
}

/**
 * The resource instances an object offers: those some action of the object
 * accepts, each once, by label. When they come from more than one module, each
 * label names its module, since two modules may each hold a "Hype" counter.
 */
export function resourceObjectInstances(object: ActionObject, rows: readonly ResourceInstanceRow[]): ObjectInstance[] {
  const byId = new Map<string, ResourceInstanceRow>();
  for (const row of rows) {
    const kind = `${row.moduleName}:${row.kind}`;
    const wanted = object.actions.some(
      (action) =>
        action.targetField?.type === "resource_ref" && resourceKindMatches(action.targetField.resourceKind, kind)
    );
    if (wanted && !byId.has(row.canonicalId)) {
      byId.set(row.canonicalId, row);
    }
  }
  const picked = [...byId.values()];
  const modules = new Set(picked.map((row) => row.moduleName));
  return picked
    .map((row) => ({
      value: row.canonicalId,
      label: modules.size > 1 ? `${row.displayName} (${row.moduleName})` : row.displayName,
      kind: `${row.moduleName}:${row.kind}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** What a kind an instance can be created of is called when there is a choice: "counter from woofx3". */
export function kindChoiceLabel(kind: string): string {
  const parsed = parseKindRef(kind);
  if (!parsed) {
    return kind;
  }
  return parsed.module ? `${parsed.kind} from ${parsed.module}` : parsed.kind;
}

/** "Which counter?", or "Which one?" for an object that does not name its things. */
export function whichPrompt(object: Pick<ActionObject, "noun">): string {
  return `Which ${object.noun ?? "one"}?`;
}

/**
 * The parameters a new step starts with: the defaults its settings declare, and the
 * chosen thing in its setting. A setting declaring no default starts empty, since an
 * empty optional setting means something to the action (Increment counter uses the
 * counter's own step), which a made-up starting value would silently replace.
 */
export function initialParameters(action: ObjectAction, instance?: ObjectInstance): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (const field of action.preset.config?.fields ?? []) {
    if (field.defaultValue !== undefined) {
      parameters[field.id] = field.defaultValue;
    }
  }
  if (instance && action.targetField && acceptsInstance(action, instance)) {
    parameters[action.targetField.id] = instance.value;
  }
  return parameters;
}

/**
 * The action as a finished step: its name with the chosen thing in it.
 *
 * The name a manifest gives an action usually names the kind of thing it changes
 * ("Increment counter", "Add time to timer"), so the thing's own name goes in
 * front of that word: "Increment Hype counter". The word is looked for as the
 * target field's label and, for a resource, as its kind ("counter" for
 * `woofx3:counter`). A name without either word gets the thing after it:
 * "Set widget visibility on Main overlay". With nothing chosen, or a thing the
 * action cannot take, the step is the action's name as it is. An action sharing its
 * name with another of its object's ends with its module's name: "Reset counter (Tally)".
 */
export function verbLabel(action: ObjectAction, instance?: ObjectInstance): string {
  const label = instanceVerbLabel(action, instance);
  return action.qualifier ? `${label} (${action.qualifier})` : label;
}

function instanceVerbLabel(action: ObjectAction, instance?: ObjectInstance): string {
  if (!instance || !action.targetField || !acceptsInstance(action, instance)) {
    return action.preset.name;
  }
  return nameWithThing(action.preset.name, action.targetField, instance.label);
}

/** An action's name with one of the streamer's things in it, worded as verbLabel describes. */
export function nameWithThing(name: string, field: ConfigField, thing: string): string {
  const nouns = new Set([field.label.trim().toLowerCase()]);
  if (field.type === "resource_ref" && field.resourceKind) {
    nouns.add(bareKind(field.resourceKind).toLowerCase());
  }
  for (const noun of nouns) {
    if (!noun) {
      continue;
    }
    const pattern = new RegExp(`\\b${escapeRegExp(noun)}\\b`, "i");
    const match = pattern.exec(name);
    if (match) {
      const start = match.index;
      return `${name.slice(0, start)}${thing} ${name.slice(start)}`;
    }
  }
  return `${name} on ${thing}`;
}

/** The thing a configured step points at: the setting that holds it and the thing's name. */
export interface StepTarget {
  field: ConfigField;
  label: string;
}

/**
 * The thing an already configured action points at, read the way the picker
 * offers it: `preset` under its object, and the instance whose value its target
 * setting holds. `ready` is false while that object's things are still loading,
 * so "points at nothing" can be told from "not known yet".
 */
export function stepTarget(
  objects: readonly ActionObject[],
  instances: ObjectInstancesByKey,
  preset: Pick<ActionPreset, "id">,
  parameters: Readonly<Record<string, unknown>>
): { target?: StepTarget; ready: boolean } {
  for (const object of objects) {
    const action = object.actions.find((candidate) => candidate.preset.id === preset.id);
    if (!action) {
      continue;
    }
    const field = action.targetField;
    const value = field ? parameters[field.id] : undefined;
    if (!field || !object.target || typeof value !== "string" || value === "") {
      return { ready: true };
    }
    const list = instances.get(object.key);
    if (list === undefined) {
      return { ready: false };
    }
    const instance = list.find((candidate) => candidate.value === value && acceptsInstance(action, candidate));
    return instance ? { target: { field, label: instance.label }, ready: true } : { ready: true };
  }
  return { ready: true };
}

/**
 * The line under an object: the first few of the streamer's things it holds,
 * after the object's lead when it has one, or when it holds none (or names no
 * things), the first few of its actions.
 */
export function objectHint(object: ActionObject, instances: readonly ObjectInstance[] | undefined): string {
  if (object.target && instances && instances.length > 0) {
    const names = firstFew(instances.map((instance) => instance.label));
    return object.instancesLead ? `${object.instancesLead} ${names}` : names;
  }
  return firstFew(object.actions.map((action) => action.preset.name));
}

function firstFew(names: readonly string[]): string {
  const shown = 3;
  if (names.length <= shown) {
    return names.join(", ");
  }
  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}

/** The step kinds besides actions: they shape the flow rather than change anything. */
export type FlowStepKind = "pause" | "wait" | "condition";

export interface FlowBlock {
  kind: FlowStepKind;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Further words a search finds it by. */
  keywords: string;
}

export const FLOW_BLOCKS: readonly FlowBlock[] = [
  {
    kind: "pause",
    label: "Pause",
    description: "Wait a set time before the next step",
    icon: Hourglass,
    keywords: "delay seconds time sleep",
  },
  {
    kind: "wait",
    label: "Wait for something",
    description: "Hold until an event happens, with a time limit",
    icon: Clock,
    keywords: "event until happens",
  },
  {
    kind: "condition",
    label: "Check a condition",
    description: "Do different steps depending on what is true",
    icon: Split,
    keywords: "if otherwise else branch when",
  },
];

/** The instances each object holds, by object key; `undefined` while they load. */
export type ObjectInstancesByKey = ReadonlyMap<string, readonly ObjectInstance[] | undefined>;

export type ActionSearchHit =
  | {
      kind: "action";
      object: ActionObject;
      action: ObjectAction;
      instance?: ObjectInstance;
      label: string;
      /** Where it was found: the object, and the thing it acts on. */
      where: string;
    }
  | { kind: "flow"; block: FlowBlock; label: string; where: string };

/**
 * Everything matching `query`: each action once per thing it can act on (so "hype"
 * finds "Increment Hype counter"), or once on its own when none of its object's
 * things fits it, and the flow blocks in `flowBlocks`.
 *
 * Every word of the query must appear in what the hit says or where it is listed.
 * Hits rank by how well the label alone matches: all of it, its start, the start
 * of a word in it, anywhere in it, every word in it, then the rest. Ties keep the
 * objects' order, flow blocks after them, then read alphabetically.
 */
export function searchActionObjects(
  objects: readonly ActionObject[],
  instances: ObjectInstancesByKey,
  query: string,
  flowBlocks: readonly FlowBlock[] = FLOW_BLOCKS
): ActionSearchHit[] {
  const q = normalise(query);
  if (!q) {
    return [];
  }
  const words = q.split(" ");
  const scored: { hit: ActionSearchHit; score: number; order: number }[] = [];

  objects.forEach((object, order) => {
    const held = object.target ? (instances.get(object.key) ?? []) : [];
    for (const action of object.actions) {
      const fitting = instancesFor(action, held);
      const targets: (ObjectInstance | undefined)[] = fitting.length > 0 ? fitting : [undefined];
      for (const instance of targets) {
        const label = verbLabel(action, instance);
        const where = instance ? `${object.label}, ${instance.label}` : object.label;
        const haystack = normalise(`${label} ${where} ${action.preset.description}`);
        const score = labelScore(q, words, label, haystack);
        if (score !== null) {
          scored.push({ hit: { kind: "action", object, action, instance, label, where }, score, order });
        }
      }
    }
  });

  for (const block of flowBlocks) {
    const haystack = normalise(`${block.label} ${block.description} ${block.keywords}`);
    const score = labelScore(q, words, block.label, haystack);
    if (score !== null) {
      scored.push({
        hit: { kind: "flow", block, label: block.label, where: block.description },
        score,
        order: objects.length,
      });
    }
  }

  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order || a.hit.label.localeCompare(b.hit.label))
    .map((entry) => entry.hit);
}

/** Lower is better; null when some word of the query is missing from the haystack. */
function labelScore(q: string, words: readonly string[], label: string, haystack: string): number | null {
  if (!words.every((word) => haystack.includes(word))) {
    return null;
  }
  const text = normalise(label);
  if (text === q) {
    return 0;
  }
  if (text.startsWith(q)) {
    return 1;
  }
  if (text.includes(` ${q}`)) {
    return 2;
  }
  if (text.includes(q)) {
    return 3;
  }
  if (words.every((word) => text.includes(word))) {
    return 4;
  }
  return 5;
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function advancedPlacement(): ObjectPlacement {
  return { key: ADVANCED_OBJECT_KEY, label: ADVANCED_LABEL, icon: Braces, rank: ADVANCED_RANK };
}

/** The first entry, or `undefined` when there is none or it is malformed (`platform.`, `a..b`), as the action menu reads it. */
function firstTaxonomyEntry(taxonomy: readonly string[] | undefined): string | undefined {
  const first = taxonomy?.find((entry) => entry.trim() !== "");
  if (!first) {
    return undefined;
  }
  const segments = first.split(".").map((segment) => segment.trim());
  return segments.every((segment) => segment.length > 0) ? segments.join(".") : undefined;
}
