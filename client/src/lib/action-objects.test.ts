import { describe, expect, test } from "bun:test";
import { Square } from "lucide-react";
import { BUILTIN_MODULE_LABEL } from "./action-menu";
import {
  type ActionObject,
  ADVANCED_OBJECT_KEY,
  acceptsInstance,
  actionObjectKey,
  actionObjects,
  FLOW_BLOCKS,
  findTargetField,
  initialParameters,
  instancesFor,
  kindChoiceLabel,
  type ObjectInstance,
  objectHint,
  type ResourceInstanceRow,
  resourceObjectInstances,
  searchActionObjects,
  verbLabel,
  verbsFor,
  whichPrompt,
} from "./action-objects";
import type { ActionPreset, ConfigField } from "./workflow-presets";

// Modelled on the bundled woofx3 module's actions (woofx3 modules/woofx3/manifest.json),
// copied here because CI checks out the engine without modules/. Resource kinds are
// qualified, as the engine stores them once the module is installed.
function action(
  id: string,
  name: string,
  taxonomy: string[] | undefined,
  fields: ConfigField[] = [],
  source = "woofx3",
  description = ""
): ActionPreset {
  return {
    id,
    canonicalRef: `woofx3:action:${id}`,
    handlerType: "function",
    functionCall: id,
    name,
    description,
    icon: Square,
    category: "General",
    color: "text-primary",
    source,
    taxonomy,
    config: { fields },
  };
}

function resourceTarget(kind: string, label: string): ConfigField {
  return { id: "target", label, type: "resource_ref", resourceKind: kind, required: true };
}

const amount: ConfigField = { id: "amount", label: "Amount", type: "number", min: 1 };
const seconds: ConfigField = { id: "seconds", label: "Seconds", type: "number", unit: "seconds", required: true };
const entry: ConfigField = { id: "entry", label: "Entry", type: "text", required: true };

const CHAT_REPLY = action(
  "chat.reply",
  "Send chat message",
  ["chat"],
  [{ id: "message", label: "Message", type: "text", required: true }]
);
const ALERT = action(
  "alert",
  "Alert",
  ["overlay.alerts", "alert.renderer"],
  [
    { id: "target", label: "Alert widget", type: "text", source: { kind: "alertWidgets" }, defaultValue: "default" },
    { id: "layout", label: "Alert", type: "layout", surface: "alert", required: true },
  ]
);
const WIDGET_VISIBILITY = action(
  "scene.widget.visibility",
  "Set widget visibility",
  ["overlay.scenes"],
  [
    { id: "sceneId", label: "Scene", type: "text", required: true, source: { kind: "scenes" } },
    {
      id: "placementId",
      label: "Widget",
      type: "text",
      required: true,
      source: { kind: "scenePlacements", sceneField: "sceneId" },
    },
    { id: "visible", label: "Visible", type: "toggle", defaultValue: true },
  ]
);
const FUNCTION = action("function", "Function", ["workflow"]);
const PRINT = action("print", "Print", ["workflow"]);
const INCREMENT = action(
  "counter.increment",
  "Increment counter",
  ["tools.counter"],
  [resourceTarget("woofx3:counter", "Counter"), amount]
);
const RESET_COUNTER = action(
  "counter.reset",
  "Reset counter",
  ["tools.counter"],
  [resourceTarget("woofx3:counter", "Counter")]
);
const ADD_TIME = action(
  "timer.add",
  "Add time to timer",
  ["tools.timer"],
  [resourceTarget("woofx3:timer", "Timer"), seconds]
);
const READ_TIMER = action("timer.get", "Read timer", ["tools.timer"], [resourceTarget("woofx3:timer", "Timer")]);
const ADD_TO_QUEUE = action(
  "queue.add",
  "Add to queue",
  ["tools.queue"],
  [resourceTarget("woofx3:queue", "Queue"), entry]
);
const TAKE_NEXT = action(
  "queue.next",
  "Take next from queue",
  ["tools.queue"],
  [resourceTarget("woofx3:queue", "Queue")]
);
const SHOUTOUT = action("twitch.shoutout", "Give a shoutout", ["platform.twitch"], [], "Twitch Platform");
const SCENE_SWITCH = action("obs.scene", "Switch OBS scene", undefined, [], "OBS");

const CATALOG: ActionPreset[] = [
  SCENE_SWITCH,
  PRINT,
  TAKE_NEXT,
  ADD_TO_QUEUE,
  READ_TIMER,
  ADD_TIME,
  RESET_COUNTER,
  INCREMENT,
  SHOUTOUT,
  FUNCTION,
  WIDGET_VISIBILITY,
  ALERT,
  CHAT_REPLY,
];

function objectByKey(key: string): ActionObject {
  const found = actionObjects(CATALOG).find((object) => object.key === key);
  if (!found) {
    throw new Error(`no object ${key}`);
  }
  return found;
}

const HYPE: ObjectInstance = { value: "woofx3:counter:hype", label: "Hype", kind: "woofx3:counter" };
const DEATHS: ObjectInstance = { value: "woofx3:counter:deaths", label: "Deaths", kind: "woofx3:counter" };
const BREAK: ObjectInstance = { value: "woofx3:timer:break", label: "Break", kind: "woofx3:timer" };
const SONGS: ObjectInstance = { value: "woofx3:queue:songs", label: "Song requests", kind: "woofx3:queue" };

// A second module declaring its own counter kind, with an action filed under the
// same taxonomy entry as the bundled counter actions.
const BUMP_TALLY = action(
  "tally.bump",
  "Bump counter",
  ["tools.counter"],
  [resourceTarget("tally:counter", "Counter"), amount],
  "Tally"
);
const TALLY_HYPE: ObjectInstance = { value: "tally:counter:hype", label: "Hype (tally)", kind: "tally:counter" };

function row(moduleName: string, kind: string, id: string, displayName: string): ResourceInstanceRow {
  return { canonicalId: `${moduleName}:${kind}:${id}`, displayName, moduleName, kind };
}
const MAIN_SCENE: ObjectInstance = { value: "scene-1", label: "Main overlay" };

describe("actionObjectKey", () => {
  test("reads the object from the first taxonomy entry", () => {
    expect(actionObjectKey(CHAT_REPLY)).toBe("chat");
    expect(actionObjectKey(ALERT)).toBe("alerts");
    expect(actionObjectKey(WIDGET_VISIBILITY)).toBe("scenes");
    expect(actionObjectKey(INCREMENT)).toBe("counters");
    expect(actionObjectKey(ADD_TIME)).toBe("timers");
    expect(actionObjectKey(ADD_TO_QUEUE)).toBe("queues");
  });

  test("takes entries below a named one", () => {
    expect(actionObjectKey({ source: "x", taxonomy: ["chat.moderation"] })).toBe("chat");
    expect(actionObjectKey({ source: "x", taxonomy: ["tools.counter.goals"] })).toBe("counters");
  });

  test("does not take an entry that only shares a prefix", () => {
    expect(actionObjectKey({ source: "x", taxonomy: ["chatter"] })).toBe(ADVANCED_OBJECT_KEY);
  });

  test("lists a platform's actions as that platform", () => {
    expect(actionObjectKey(SHOUTOUT)).toBe("platform:twitch");
    expect(actionObjectKey({ source: "OBS", taxonomy: ["platform.obs.scenes"] })).toBe("platform:obs");
  });

  test("files the primitives, unnamed families and a bare platform under Advanced", () => {
    expect(actionObjectKey(PRINT)).toBe(ADVANCED_OBJECT_KEY);
    expect(actionObjectKey({ source: "x", taxonomy: ["function.lighting"] })).toBe(ADVANCED_OBJECT_KEY);
    expect(actionObjectKey({ source: "x", taxonomy: ["tools.stopwatch"] })).toBe(ADVANCED_OBJECT_KEY);
    expect(actionObjectKey({ source: "x", taxonomy: ["platform"] })).toBe(ADVANCED_OBJECT_KEY);
  });

  test("lists an action with no taxonomy, or a malformed one, under its module", () => {
    expect(actionObjectKey(SCENE_SWITCH)).toBe("module:OBS");
    expect(actionObjectKey({ source: "Govee", taxonomy: ["platform."] })).toBe("module:Govee");
    expect(actionObjectKey({ source: "Govee", taxonomy: [] })).toBe("module:Govee");
  });

  test("files a built-in action with no taxonomy under Advanced", () => {
    expect(actionObjectKey({ source: BUILTIN_MODULE_LABEL, taxonomy: undefined })).toBe(ADVANCED_OBJECT_KEY);
  });
});

describe("actionObjects", () => {
  test("orders named objects first, then platforms and modules, then Advanced last", () => {
    expect(actionObjects(CATALOG).map((object) => object.label)).toEqual([
      "Chat",
      "Alerts",
      "Scenes",
      "Counters",
      "Timers",
      "Queues",
      "Twitch",
      "OBS",
      "Advanced",
    ]);
  });

  test("leaves out objects the catalog has no actions for", () => {
    expect(actionObjects([CHAT_REPLY, PRINT]).map((object) => object.key)).toEqual(["chat", ADVANCED_OBJECT_KEY]);
  });

  test("lists an object's actions by name", () => {
    expect(objectByKey("counters").actions.map((entry) => entry.preset.name)).toEqual([
      "Increment counter",
      "Reset counter",
    ]);
    expect(objectByKey(ADVANCED_OBJECT_KEY).actions.map((entry) => entry.preset.name)).toEqual(["Function", "Print"]);
  });

  test("names what an object's things are called", () => {
    expect(whichPrompt(objectByKey("counters"))).toBe("Which counter?");
    expect(whichPrompt(objectByKey("chat"))).toBe("Which one?");
  });

  test("asks where on the overlay an alert plays", () => {
    expect(whichPrompt(objectByKey("alerts"))).toBe("Which spot on your overlay?");
  });

  test("takes an object's kinds from what its actions' target fields name", () => {
    expect(objectByKey("counters").target).toEqual({ type: "resource", kinds: ["woofx3:counter"] });
    const counters = actionObjects([INCREMENT, BUMP_TALLY, RESET_COUNTER])[0];
    expect(counters.target).toEqual({ type: "resource", kinds: ["woofx3:counter", "tally:counter"] });
  });

  test("keeps a bare kind a module installed before kinds were qualified names", () => {
    const legacy = action(
      "counter.increment",
      "Increment counter",
      ["tools.counter"],
      [resourceTarget("counter", "Counter")]
    );
    expect(actionObjects([legacy])[0].target).toEqual({ type: "resource", kinds: ["counter"] });
  });

  test("gives a resource object no target when none of its actions names a kind", () => {
    const untargeted = action("counter.list", "List counters", ["tools.counter"]);
    expect(actionObjects([untargeted])[0].target).toBeUndefined();
  });
});

describe("findTargetField", () => {
  test("finds the resource_ref field of the object's kind", () => {
    expect(objectByKey("counters").actions.map((entry) => entry.targetField?.id)).toEqual(["target", "target"]);
    expect(findTargetField(ADD_TIME, { type: "resource", kindName: "timer" })?.id).toBe("target");
    expect(findTargetField(TAKE_NEXT, { type: "resource", kindName: "queue" })?.id).toBe("target");
  });

  test("finds another module's kind of the same name", () => {
    const [bump] = actionObjects([INCREMENT, BUMP_TALLY])[0].actions;
    expect(bump.preset.id).toBe("tally.bump");
    expect(bump.targetField?.id).toBe("target");
  });

  test("matches a bare kind from a module installed before kinds were qualified", () => {
    const legacy = action(
      "counter.increment",
      "Increment counter",
      ["tools.counter"],
      [resourceTarget("counter", "Counter")]
    );
    expect(findTargetField(legacy, { type: "resource", kindName: "counter" })?.id).toBe("target");
  });

  test("falls back to an action's only resource_ref when it names another kind", () => {
    expect(findTargetField(ADD_TIME, { type: "resource", kindName: "counter" })?.id).toBe("target");
    const points = action(
      "points.add",
      "Add points",
      ["tools.counter"],
      [resourceTarget("points:tally", "Tally"), amount],
      "Points"
    );
    const [only] = actionObjects([points])[0].actions;
    expect(only.targetField?.id).toBe("target");
    expect(actionObjects([points])[0].target).toEqual({ type: "resource", kinds: ["points:tally"] });
  });

  test("picks no field when several resource_refs name other kinds", () => {
    const transfer = action(
      "transfer",
      "Move time",
      ["tools.counter"],
      [resourceTarget("woofx3:timer", "From"), { ...resourceTarget("woofx3:timer", "To"), id: "to" }]
    );
    expect(findTargetField(transfer, { type: "resource", kindName: "counter" })).toBeUndefined();
  });

  test("finds the field whose options are the scenes or alert widgets", () => {
    expect(objectByKey("scenes").actions[0].targetField?.id).toBe("sceneId");
    expect(objectByKey("alerts").actions[0].targetField?.id).toBe("target");
  });

  test("leaves an action with no matching setting without a target", () => {
    expect(objectByKey("chat").actions[0].targetField).toBeUndefined();
    expect(findTargetField(FUNCTION, { type: "source", source: "scenes" })).toBeUndefined();
  });
});

describe("resourceObjectInstances", () => {
  const counters = actionObjects([INCREMENT, BUMP_TALLY])[0];

  test("offers the instances some action of the object accepts, by label", () => {
    const rows = [row("woofx3", "counter", "hype", "Hype"), row("woofx3", "counter", "deaths", "Deaths")];
    expect(resourceObjectInstances(objectByKey("counters"), rows)).toEqual([DEATHS, HYPE]);
  });

  test("leaves out instances of a kind no action accepts", () => {
    const rows = [row("woofx3", "counter", "hype", "Hype"), row("rival", "counter", "hype", "Hype")];
    expect(resourceObjectInstances(objectByKey("counters"), rows).map((instance) => instance.value)).toEqual([
      "woofx3:counter:hype",
    ]);
  });

  test("names the module when instances come from more than one", () => {
    const rows = [row("woofx3", "counter", "hype", "Hype"), row("tally", "counter", "hype", "Hype")];
    expect(resourceObjectInstances(counters, rows).map((instance) => instance.label)).toEqual([
      "Hype (tally)",
      "Hype (woofx3)",
    ]);
  });

  test("lists an instance once when it arrives twice", () => {
    const rows = [row("woofx3", "counter", "hype", "Hype"), row("woofx3", "counter", "hype", "Hype")];
    expect(resourceObjectInstances(objectByKey("counters"), rows)).toEqual([HYPE]);
  });

  test("takes any module's instance of the name for a bare kind", () => {
    const legacy = action(
      "counter.increment",
      "Increment counter",
      ["tools.counter"],
      [resourceTarget("counter", "Counter")]
    );
    const object = actionObjects([legacy])[0];
    expect(resourceObjectInstances(object, [row("woofx3", "counter", "hype", "Hype")])).toEqual([HYPE]);
  });
});

describe("acceptsInstance", () => {
  const [bump, increment] = actionObjects([INCREMENT, BUMP_TALLY])[0].actions;

  test("gives an action only instances of the kinds its target field names", () => {
    expect(acceptsInstance(increment, HYPE)).toBe(true);
    expect(acceptsInstance(increment, TALLY_HYPE)).toBe(false);
    expect(acceptsInstance(bump, TALLY_HYPE)).toBe(true);
    expect(acceptsInstance(bump, HYPE)).toBe(false);
    expect(instancesFor(bump, [HYPE, TALLY_HYPE, DEATHS])).toEqual([TALLY_HYPE]);
  });

  test("gives a legacy bare-kind action an instance of that name from any module", () => {
    const legacy = actionObjects([
      action("counter.increment", "Increment counter", ["tools.counter"], [resourceTarget("counter", "Counter")]),
    ])[0].actions[0];
    expect(instancesFor(legacy, [HYPE, TALLY_HYPE])).toEqual([HYPE, TALLY_HYPE]);
  });

  test("fits a scene or alert widget to any action of its object with a target", () => {
    expect(acceptsInstance(objectByKey("scenes").actions[0], MAIN_SCENE)).toBe(true);
    expect(acceptsInstance(objectByKey("chat").actions[0], MAIN_SCENE)).toBe(false);
  });

  test("never fills an action's setting with an instance it cannot take", () => {
    expect(initialParameters(bump, HYPE)).toEqual({});
    expect(verbLabel(bump, HYPE)).toBe("Bump counter");
    expect(verbLabel(bump, TALLY_HYPE)).toBe("Bump Hype (tally) counter");
  });
});

describe("verbsFor", () => {
  const counters = actionObjects([
    INCREMENT,
    BUMP_TALLY,
    action("counter.create", "Create counter", ["tools.counter"]),
  ])[0];

  test("hides the actions that can't take the chosen thing", () => {
    expect(verbsFor(counters, HYPE).map((entry) => entry.preset.id)).toEqual(["counter.create", "counter.increment"]);
    expect(verbsFor(counters, TALLY_HYPE).map((entry) => entry.preset.id)).toEqual(["tally.bump", "counter.create"]);
  });

  test("offers every action while nothing is chosen", () => {
    expect(verbsFor(counters, undefined)).toHaveLength(3);
  });
});

describe("actions sharing a name", () => {
  const reset = action(
    "tally.reset",
    "Reset counter",
    ["tools.counter"],
    [resourceTarget("tally:counter", "Counter")],
    "Tally"
  );
  const counters = actionObjects([RESET_COUNTER, reset])[0];

  test("name the module each comes from", () => {
    expect(counters.actions.map((entry) => verbLabel(entry))).toEqual([
      "Reset counter (Tally)",
      "Reset counter (woofx3)",
    ]);
    expect(verbLabel(counters.actions[1], HYPE)).toBe("Reset Hype counter (woofx3)");
  });

  test("leave a name no other action has as it is", () => {
    expect(objectByKey("counters").actions.every((entry) => entry.qualifier === undefined)).toBe(true);
  });
});

describe("kindChoiceLabel", () => {
  test("names the module a kind comes from", () => {
    expect(kindChoiceLabel("tally:counter")).toBe("counter from tally");
    expect(kindChoiceLabel("counter")).toBe("counter");
  });
});

describe("initialParameters", () => {
  test("leaves a setting with no declared default empty, so the action uses its own", () => {
    const increment = objectByKey("counters").actions[0];
    expect(initialParameters(increment)).toEqual({});
  });

  test("fills the target field with the chosen instance over the defaults", () => {
    const increment = objectByKey("counters").actions[0];
    expect(initialParameters(increment, HYPE)).toEqual({ target: "woofx3:counter:hype" });
  });

  test("replaces a declared default with the chosen alert widget", () => {
    const alert = objectByKey("alerts").actions[0];
    expect(initialParameters(alert, { value: "sidebar", label: "sidebar" })).toMatchObject({ target: "sidebar" });
    expect(initialParameters(alert)).toMatchObject({ target: "default" });
  });

  test("keeps the other fields' defaults for a scene action", () => {
    const visibility = objectByKey("scenes").actions[0];
    expect(initialParameters(visibility, MAIN_SCENE)).toEqual({ sceneId: "scene-1", visible: true });
  });

  test("ignores an instance when the action has nowhere to put it", () => {
    const chat = objectByKey("chat").actions[0];
    expect(initialParameters(chat, HYPE)).toEqual({});
  });
});

describe("verbLabel", () => {
  test("puts the instance's name in front of the word for its kind", () => {
    const [increment, reset] = objectByKey("counters").actions;
    expect(verbLabel(increment, HYPE)).toBe("Increment Hype counter");
    expect(verbLabel(reset, DEATHS)).toBe("Reset Deaths counter");
    const [addTime, read] = objectByKey("timers").actions;
    expect(verbLabel(addTime, BREAK)).toBe("Add time to Break timer");
    expect(verbLabel(read, BREAK)).toBe("Read Break timer");
    const [add, next] = objectByKey("queues").actions;
    expect(verbLabel(add, SONGS)).toBe("Add to Song requests queue");
    expect(verbLabel(next, SONGS)).toBe("Take next from Song requests queue");
  });

  test("finds the word by the kind when the field's label differs", () => {
    const relabelled = action(
      "counter.increment",
      "Increment counter",
      ["tools.counter"],
      [resourceTarget("woofx3:counter", "Which tally")]
    );
    const [entryAction] = actionObjects([relabelled])[0].actions;
    expect(verbLabel(entryAction, HYPE)).toBe("Increment Hype counter");
  });

  test("matches whole words only, ignoring case", () => {
    const named = action("x", "Counterfeit COUNTER", ["tools.counter"], [resourceTarget("woofx3:counter", "Counter")]);
    const [entryAction] = actionObjects([named])[0].actions;
    expect(verbLabel(entryAction, HYPE)).toBe("Counterfeit Hype COUNTER");
  });

  test("adds the instance after a name that does not name its kind", () => {
    expect(verbLabel(objectByKey("scenes").actions[0], MAIN_SCENE)).toBe("Set widget visibility on Main overlay");
    expect(verbLabel(objectByKey("alerts").actions[0], { value: "sidebar", label: "sidebar" })).toBe(
      "Alert on sidebar"
    );
  });

  test("is the action's name with nothing chosen or no target field", () => {
    expect(verbLabel(objectByKey("counters").actions[0])).toBe("Increment counter");
    expect(verbLabel(objectByKey("chat").actions[0], HYPE)).toBe("Send chat message");
  });

  test("does not read the instance's name as a replacement pattern", () => {
    expect(verbLabel(objectByKey("counters").actions[0], { value: "v", label: "$& $1", kind: "woofx3:counter" })).toBe(
      "Increment $& $1 counter"
    );
  });
});

describe("objectHint", () => {
  test("names the first few instances", () => {
    const counters = objectByKey("counters");
    expect(objectHint(counters, [HYPE, DEATHS])).toBe("Hype, Deaths");
    const many = ["A", "B", "C", "D", "E"].map((label) => ({ value: label, label }));
    expect(objectHint(counters, many)).toBe("A, B, C and 2 more");
  });

  test("says an alert's spots are on the overlay", () => {
    const spots = [
      { value: "default", label: "default" },
      { value: "sidebar", label: "sidebar" },
    ];
    expect(objectHint(objectByKey("alerts"), spots)).toBe("Plays on your overlay at default, sidebar");
    expect(objectHint(objectByKey("alerts"), [])).toBe("Alert");
  });

  test("names the actions when there are no instances, or no things to have", () => {
    expect(objectHint(objectByKey("counters"), [])).toBe("Increment counter, Reset counter");
    expect(objectHint(objectByKey("chat"), undefined)).toBe("Send chat message");
  });
});

describe("searchActionObjects", () => {
  const objects = actionObjects(CATALOG);
  const instances = new Map<string, readonly ObjectInstance[] | undefined>([
    ["counters", [DEATHS, HYPE]],
    ["timers", [BREAK]],
    ["queues", []],
    ["scenes", undefined],
    ["alerts", [{ value: "default", label: "default" }]],
  ]);

  function labels(query: string, blocks = FLOW_BLOCKS) {
    return searchActionObjects(objects, instances, query, blocks).map((hit) => hit.label);
  }

  test("finds an instance by its own name", () => {
    expect(labels("hype")).toEqual(["Increment Hype counter", "Reset Hype counter"]);
  });

  test("offers an action once per instance it can act on", () => {
    expect(labels("increment")).toEqual(["Increment Deaths counter", "Increment Hype counter"]);
  });

  test("offers an action on its own when its object has no instances yet", () => {
    expect(labels("add to")).toEqual(["Add to queue", "Add time to Break timer"]);
    expect(labels("widget visibility")).toEqual(["Set widget visibility"]);
  });

  test("needs every word, in any order and across label and where it is listed", () => {
    expect(labels("counter hype reset")).toEqual(["Reset Hype counter"]);
    expect(labels("timers break")).toEqual(["Add time to Break timer", "Read Break timer"]);
    expect(labels("hype timer")).toEqual([]);
  });

  test("ranks a label match above a match only on where it is listed", () => {
    const hits = searchActionObjects(objects, instances, "twitch", FLOW_BLOCKS);
    expect(hits.map((hit) => hit.label)).toEqual(["Give a shoutout"]);
    expect(hits[0].where).toBe("Twitch");
  });

  test("ranks an exact label over one that starts with it, over a word inside one", () => {
    const pauseTimer = action("timer.pause", "Pause timer", ["tools.timer"], [resourceTarget("woofx3:timer", "Timer")]);
    const withPause = actionObjects([...CATALOG, pauseTimer]);
    const hits = searchActionObjects(withPause, instances, "pause", FLOW_BLOCKS).map((hit) => hit.label);
    expect(hits).toEqual(["Pause", "Pause Break timer"]);
    expect(labels("print")).toEqual(["Print"]);
    expect(labels("counter")[0]).toBe("Increment Deaths counter");
  });

  test("finds the flow blocks by their words, and only those offered", () => {
    expect(labels("if")).toEqual(["Check a condition"]);
    expect(labels("wait")).toEqual(["Wait for something", "Pause"]);
    expect(labels("if", [])).toEqual([]);
  });

  test("offers each action only the instances it accepts", () => {
    const counters = actionObjects([INCREMENT, BUMP_TALLY]);
    const held = new Map([["counters", [HYPE, TALLY_HYPE]]]);
    expect(searchActionObjects(counters, held, "hype", []).map((hit) => hit.label)).toEqual([
      "Bump Hype (tally) counter",
      "Increment Hype counter",
    ]);
  });

  test("says where an instance hit was found", () => {
    const [hit] = searchActionObjects(objects, instances, "reset hype", FLOW_BLOCKS);
    expect(hit).toMatchObject({ kind: "action", where: "Counters, Hype", instance: HYPE });
  });

  test("returns nothing for a blank query", () => {
    expect(labels("   ")).toEqual([]);
  });
});
