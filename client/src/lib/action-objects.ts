import { bareKind, COUNTER_KIND, QUEUE_KIND, resourceKindMatches, TIMER_KIND } from "@convex/lib/resourceKinds";
import { Braces, Clock, Hourglass, type LucideIcon, MessageSquare, Puzzle, Radio, Split } from "lucide-react";
import { BUILTIN_MODULE_LABEL } from "@/lib/action-menu";
import { taxonomyLabel } from "@/lib/alert-groups";
import { STREAM_OBJECT_ICONS } from "@/lib/stream-object-icons";
import { type ActionPreset, type ConfigField, getDefaultConfigValues } from "@/lib/workflow-presets";

/**
 * Which of the streamer's own things an object's actions act on: instances of a
 * resource kind (a `resource_ref` field naming it), or a field whose options come
 * from the streamer's scenes or alert widgets.
 */
export type ActionObjectTarget =
  | { type: "resource"; kind: string }
  | { type: "source"; source: "scenes" | "alertWidgets" };

/** One of the streamer's things, as a "Which one?" chip offers it. */
export interface ObjectInstance {
  /** What the action's target field stores: a canonical id, an engine scene id, a widget name. */
  value: string;
  label: string;
}

/** An action listed under an object, and the setting a chosen instance fills. */
export interface ObjectAction {
  preset: ActionPreset;
  /** Absent when the action has no setting for the object's things. */
  targetField?: ConfigField;
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
  actions: ObjectAction[];
}

interface ObjectDefinition {
  key: string;
  /** The taxonomy entry this object takes: the entry itself and anything under it. */
  taxonomy: string;
  label: string;
  icon: LucideIcon;
  target?: ActionObjectTarget;
  noun?: string;
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
    noun: "alert widget",
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
    target: { type: "resource", kind: COUNTER_KIND },
    noun: "counter",
  },
  {
    key: "timers",
    taxonomy: "tools.timer",
    label: "Timers",
    icon: STREAM_OBJECT_ICONS.timers,
    target: { type: "resource", kind: TIMER_KIND },
    noun: "timer",
  },
  {
    key: "queues",
    taxonomy: "tools.queue",
    label: "Queues",
    icon: STREAM_OBJECT_ICONS.queues,
    target: { type: "resource", kind: QUEUE_KIND },
    noun: "queue",
  },
];

/** The resource kinds objects list instances of; useActionObjectInstances loads exactly these. */
export const RESOURCE_OBJECT_KINDS: readonly string[] = OBJECT_DEFINITIONS.flatMap((definition) =>
  definition.target?.type === "resource" ? [definition.target.kind] : []
);

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
      return {
        key: placement.key,
        label: placement.label,
        icon: placement.icon,
        ...(definition?.target ? { target: definition.target } : {}),
        ...(definition?.noun ? { noun: definition.noun } : {}),
        actions: actions.sort((a, b) => a.preset.name.localeCompare(b.preset.name)),
      };
    });
}

/**
 * The setting a chosen thing fills: the first field that is a `resource_ref` of
 * the target's kind, or whose options come from the target's source.
 */
export function findTargetField(
  preset: Pick<ActionPreset, "config">,
  target: ActionObjectTarget
): ConfigField | undefined {
  return preset.config?.fields.find((field) => {
    if (target.type === "resource") {
      return field.type === "resource_ref" && resourceKindMatches(field.resourceKind, target.kind);
    }
    return field.source?.kind === target.source;
  });
}

/** "Which counter?", or "Which one?" for an object that does not name its things. */
export function whichPrompt(object: Pick<ActionObject, "noun">): string {
  return `Which ${object.noun ?? "one"}?`;
}

/** The parameters a new step starts with: the settings' defaults, and the chosen thing in its setting. */
export function initialParameters(action: ObjectAction, instance?: ObjectInstance): Record<string, unknown> {
  const parameters = getDefaultConfigValues(action.preset.config?.fields ?? []) as Record<string, unknown>;
  if (instance && action.targetField) {
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
 * "Set widget visibility on Main overlay". With nothing chosen, or no setting to
 * put it in, the step is the action's name as it is.
 */
export function verbLabel(action: ObjectAction, instance?: ObjectInstance): string {
  const name = action.preset.name;
  const field = action.targetField;
  if (!instance || !field) {
    return name;
  }
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
      return `${name.slice(0, start)}${instance.label} ${name.slice(start)}`;
    }
  }
  return `${name} on ${instance.label}`;
}

/**
 * The line under an object: the first few of the streamer's things it holds, or
 * when it holds none (or names no things), the first few of its actions.
 */
export function objectHint(object: ActionObject, instances: readonly ObjectInstance[] | undefined): string {
  const shown = 3;
  const names =
    object.target && instances && instances.length > 0
      ? instances.map((instance) => instance.label)
      : object.actions.map((action) => action.preset.name);
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
 * finds "Increment Hype counter"), or once on its own when it has no things to act
 * on yet, and the flow blocks in `flowBlocks`.
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
      const targets: (ObjectInstance | undefined)[] = action.targetField && held.length > 0 ? [...held] : [undefined];
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
