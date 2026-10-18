import { describe, expect, test } from "bun:test";
import { COUNTER_KIND, QUEUE_KIND, TIMER_KIND } from "@convex/lib/resourceKinds";
import { Square } from "lucide-react";
import { BUILTIN_MODULE_LABEL } from "./action-menu";
import {
  type ActionObject,
  ADVANCED_OBJECT_KEY,
  actionObjectKey,
  actionObjects,
  FLOW_BLOCKS,
  findTargetField,
  initialParameters,
  type ObjectInstance,
  objectHint,
  RESOURCE_OBJECT_KINDS,
  searchActionObjects,
  verbLabel,
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

const HYPE: ObjectInstance = { value: "woofx3:counter:hype", label: "Hype" };
const DEATHS: ObjectInstance = { value: "woofx3:counter:deaths", label: "Deaths" };
const BREAK: ObjectInstance = { value: "woofx3:timer:break", label: "Break" };
const SONGS: ObjectInstance = { value: "woofx3:queue:songs", label: "Song requests" };
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
    expect(whichPrompt(objectByKey("alerts"))).toBe("Which alert widget?");
    expect(whichPrompt(objectByKey("chat"))).toBe("Which one?");
  });

  test("loads instances for exactly the kinds the hook queries", () => {
    expect(RESOURCE_OBJECT_KINDS).toEqual([COUNTER_KIND, TIMER_KIND, QUEUE_KIND]);
  });
});

describe("findTargetField", () => {
  test("finds the resource_ref field of the object's kind", () => {
    expect(objectByKey("counters").actions.map((entry) => entry.targetField?.id)).toEqual(["target", "target"]);
    expect(findTargetField(ADD_TIME, { type: "resource", kind: TIMER_KIND })?.id).toBe("target");
    expect(findTargetField(TAKE_NEXT, { type: "resource", kind: QUEUE_KIND })?.id).toBe("target");
  });

  test("matches a bare kind from a module installed before kinds were qualified", () => {
    const legacy = action(
      "counter.increment",
      "Increment counter",
      ["tools.counter"],
      [resourceTarget("counter", "Counter")]
    );
    expect(findTargetField(legacy, { type: "resource", kind: COUNTER_KIND })?.id).toBe("target");
  });

  test("ignores a resource_ref of another kind or another module", () => {
    expect(findTargetField(ADD_TIME, { type: "resource", kind: COUNTER_KIND })).toBeUndefined();
    const foreign = action("x", "Bump counter", ["tools.counter"], [resourceTarget("other:counter", "Counter")]);
    expect(findTargetField(foreign, { type: "resource", kind: COUNTER_KIND })).toBeUndefined();
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

describe("initialParameters", () => {
  test("fills the target field with the chosen instance over the defaults", () => {
    const increment = objectByKey("counters").actions[0];
    expect(initialParameters(increment, HYPE)).toEqual({ target: "woofx3:counter:hype", amount: 1 });
  });

  test("replaces a declared default with the chosen alert widget", () => {
    const alert = objectByKey("alerts").actions[0];
    expect(initialParameters(alert, { value: "sidebar", label: "sidebar" })).toMatchObject({ target: "sidebar" });
    expect(initialParameters(alert)).toMatchObject({ target: "default" });
  });

  test("keeps the other fields' defaults for a scene action", () => {
    const visibility = objectByKey("scenes").actions[0];
    expect(initialParameters(visibility, MAIN_SCENE)).toEqual({ sceneId: "scene-1", placementId: "", visible: true });
  });

  test("ignores an instance when the action has nowhere to put it", () => {
    const chat = objectByKey("chat").actions[0];
    expect(initialParameters(chat, HYPE)).toEqual({ message: "" });
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
    expect(verbLabel(objectByKey("counters").actions[0], { value: "v", label: "$& $1" })).toBe(
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

  test("says where an instance hit was found", () => {
    const [hit] = searchActionObjects(objects, instances, "reset hype", FLOW_BLOCKS);
    expect(hit).toMatchObject({ kind: "action", where: "Counters, Hype", instance: HYPE });
  });

  test("returns nothing for a blank query", () => {
    expect(labels("   ")).toEqual([]);
  });
});
