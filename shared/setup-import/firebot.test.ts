import { describe, expect, test } from "bun:test";
import { convertFirebot } from "./firebot";
import type { JsonRecord } from "./read";
import { type ImportItem, itemReadiness } from "./types";

function chat(message: string): JsonRecord {
  return { id: crypto.randomUUID(), type: "firebot:chat", message, chatter: "Streamer" };
}

function effects(...list: JsonRecord[]): JsonRecord {
  return { id: crypto.randomUUID(), list };
}

function convert(components: JsonRecord) {
  return convertFirebot({ name: "My setup", components });
}

function only<K extends ImportItem["kind"]>(items: ImportItem[], kind: K): Extract<ImportItem, { kind: K }> {
  const matching = items.filter((item) => item.kind === kind);
  expect(matching).toHaveLength(1);
  return matching[0] as Extract<ImportItem, { kind: K }>;
}

describe("convertFirebot commands", () => {
  test("a command that only chats becomes a command with chat actions", () => {
    const plan = convert({
      commands: [
        {
          id: "c1",
          type: "custom",
          active: true,
          trigger: "!Hello",
          cooldown: { global: 30 },
          effects: effects(chat("Hi $user!")),
        },
      ],
    });
    const command = only(plan.items, "command");
    expect(command.spec.command).toBe("hello");
    expect(command.spec.cooldown).toBe(30);
    expect(command.spec.steps).toEqual([
      {
        kind: "action",
        label: "Send chat message",
        ref: "woofx3:action:chat.reply",
        parameters: { message: "Hi ${trigger.data.chatter}!" },
      },
    ]);
    expect(itemReadiness(command)).toBe("ready");
  });

  test("a command with a delay comes with a workflow on its chat event", () => {
    const plan = convert({
      commands: [
        {
          id: "c1",
          trigger: "!hug",
          effects: effects(chat("one"), { id: "d", type: "firebot:delay", delay: 2 }, chat("two")),
        },
      ],
    });
    const command = only(plan.items, "command");
    const workflow = only(plan.items, "workflow");
    expect(command.spec.steps).toEqual([]);
    expect(workflow.spec.commandKey).toBe(command.key);
    expect(workflow.spec.trigger).toEqual({ kind: "event", event: "chat.command.hug", conditions: [], logic: "and" });
    expect(workflow.spec.steps.map((step) => step.kind)).toEqual(["action", "delay", "action"]);
  });

  test("aliases become commands of their own", () => {
    const plan = convert({
      commands: [{ id: "c1", trigger: "!discord", aliases: ["!dc", "!discord"], effects: effects(chat("link")) }],
    });
    expect(plan.items.map((item) => (item.kind === "command" ? item.spec.command : null))).toEqual(["discord", "dc"]);
  });

  test("moderator-only stays moderator-only, and subscriber-only is never opened to everyone", () => {
    const plan = convert({
      commands: [
        {
          id: "mods",
          trigger: "!so",
          restrictionData: { restrictions: [{ type: "firebot:permissions", mode: "roles", roleIds: ["mod"] }] },
          effects: effects(chat("x")),
        },
        {
          id: "subs",
          trigger: "!perk",
          restrictionData: { restrictions: [{ type: "firebot:permissions", mode: "roles", roleIds: ["sub"] }] },
          effects: effects(chat("x")),
        },
      ],
    });
    const [mods, subs] = plan.items.filter((item) => item.kind === "command");
    expect(mods.kind === "command" && mods.spec.access.builtIn).toEqual(["moderator"]);
    expect(subs.kind === "command" && subs.spec.access.builtIn).toEqual(["broadcaster", "moderator"]);
    expect(itemReadiness(subs)).toBe("partial");
  });

  test("custom roles become groups the command is limited to", () => {
    const plan = convert({
      viewerRoles: [{ id: "r1", name: "Regulars", viewers: [{ id: "1", username: "Alice", displayName: "Alice" }] }],
      commands: [
        {
          id: "c1",
          trigger: "!regular",
          restrictionData: { restrictions: [{ type: "firebot:permissions", mode: "roles", roleIds: ["r1"] }] },
          effects: effects(chat("hi")),
        },
      ],
    });
    const group = only(plan.items, "group");
    expect(group.spec).toEqual({ name: "Regulars", description: "Imported from Firebot.", members: ["alice"] });
    expect(only(plan.items, "command").spec.access.groupKeys).toEqual([group.key]);
  });

  test("a regex trigger or a currency cost cannot come over", () => {
    const plan = convert({
      commands: [
        { id: "a", trigger: "^hi.*", triggerIsRegex: true, effects: effects(chat("x")) },
        {
          id: "b",
          trigger: "!buy",
          restrictionData: { restrictions: [{ type: "firebot:channelcurrency", selectedCurrency: "x", amount: 5 }] },
          effects: effects(chat("x")),
        },
      ],
    });
    expect(plan.items.map(itemReadiness)).toEqual(["unsupported", "unsupported"]);
  });

  test("system commands are left to woofx3", () => {
    expect(convert({ commands: [{ id: "s", type: "system", trigger: "!commands" }] }).items).toEqual([]);
  });
});

describe("convertFirebot effects", () => {
  test("conditional effects become nested branches", () => {
    const plan = convert({
      commands: [
        {
          id: "c1",
          trigger: "!check",
          effects: effects({
            id: "if",
            type: "firebot:conditional-effects",
            ifs: [
              {
                conditionData: {
                  mode: "exclusive",
                  conditions: [
                    {
                      type: "firebot:custom",
                      comparisonType: "is",
                      leftSideValue: "$arg[1]",
                      rightSideValue: "yes",
                    },
                  ],
                },
                effectData: effects(chat("yes")),
              },
              {
                conditionData: {
                  conditions: [{ type: "firebot:username", comparisonType: "is", rightSideValue: "wolfy" }],
                },
                effectData: effects(chat("boss")),
              },
            ],
            otherwiseEffectData: effects(chat("no")),
          }),
        },
      ],
    });
    const workflow = only(plan.items, "workflow");
    const [outer] = workflow.spec.steps;
    expect(outer.kind).toBe("branch");
    if (outer.kind !== "branch") {
      return;
    }
    expect(outer.conditions).toEqual([{ field: "${trigger.data.args[0]}", operator: "eq", value: "yes" }]);
    const [inner] = outer.whenFalse;
    expect(inner.kind === "branch" && inner.conditions).toEqual([
      { field: "${trigger.data.chatter}", operator: "eq", value: "wolfy" },
    ]);
    expect(inner.kind === "branch" && inner.whenFalse.length).toBe(1);
  });

  test("preset lists are copied in with their arguments filled", () => {
    const plan = convert({
      presetEffectLists: [{ id: "p1", name: "Greet", args: [{ name: "who" }], effects: effects(chat("Hello $#who")) }],
      commands: [
        {
          id: "c1",
          trigger: "!greet",
          effects: effects({
            id: "run",
            type: "firebot:run-effect-list",
            listType: "preset",
            presetListId: "p1",
            presetListArgs: { who: "$user" },
          }),
        },
      ],
    });
    expect(only(plan.items, "command").spec.steps[0].parameters.message).toBe("Hello ${trigger.data.chatter}");
  });

  test("counter updates point at the imported counter", () => {
    const plan = convert({
      counters: [{ id: "k1", name: "Death Count", value: 3 }],
      commands: [
        {
          id: "c1",
          trigger: "!death",
          effects: effects({ id: "u", type: "firebot:update-counter", counterId: "k1", mode: "increment", value: "1" }),
        },
      ],
    });
    const counter = only(plan.items, "counter");
    expect(counter.spec).toEqual({ resourceInstanceId: "death_count", displayName: "Death Count", initialValue: 3 });
    expect(only(plan.items, "command").spec.steps[0]).toEqual({
      kind: "action",
      label: "Increase counter",
      ref: "woofx3:action:counter.increment",
      parameters: { target: { counterKey: counter.key }, amount: 1 },
    });
  });

  test("effects woofx3 cannot run are left out and reported", () => {
    const plan = convert({
      commands: [
        {
          id: "c1",
          trigger: "!airhorn",
          effects: effects({ id: "s", type: "firebot:playsound", filepath: "C:/horn.mp3" }, chat("HONK")),
        },
      ],
    });
    const command = only(plan.items, "command");
    expect(command.spec.steps).toHaveLength(1);
    expect(command.notes.map((note) => note.message)).toEqual([
      "Leaves out the Play Sound effect, which woofx3 cannot run yet.",
    ]);
  });

  test("a command with nothing left to run cannot come over", () => {
    const plan = convert({
      commands: [{ id: "c1", trigger: "!horn", effects: effects({ id: "s", type: "firebot:playsound" }) }],
    });
    expect(itemReadiness(plan.items[0])).toBe("unsupported");
  });
});

describe("convertFirebot events, timers and leftovers", () => {
  test("a reward event filtered to one reward keeps its filter", () => {
    const plan = convert({
      events: [
        {
          id: "e1",
          name: "Hydrate",
          active: true,
          sourceId: "twitch",
          eventId: "channel-reward-redemption",
          filterData: { mode: "exclusive", filters: [{ type: "firebot:reward", comparisonType: "is", value: "abc" }] },
          effects: effects(chat("$username says drink water: $rewardMessage")),
        },
      ],
    });
    const workflow = only(plan.items, "workflow");
    expect(workflow.spec.trigger).toEqual({
      kind: "event",
      event: "channelpoints.redeem",
      conditions: [{ field: "${trigger.data.rewardId}", operator: "eq", value: "abc" }],
      logic: "and",
    });
    expect(itemReadiness(workflow)).toBe("ready");
  });

  test("a filter woofx3 cannot check blocks the event instead of widening it", () => {
    const plan = convert({
      events: [
        {
          id: "e1",
          sourceId: "twitch",
          eventId: "chat-message",
          filterData: { filters: [{ type: "firebot:viewerroles", comparisonType: "include", value: "vip" }] },
          effects: effects(chat("hi")),
        },
      ],
    });
    expect(itemReadiness(plan.items[0])).toBe("unsupported");
  });

  test("the sub event splits into new subs and resubs unless filtered to one", () => {
    const both = convert({
      events: [{ id: "e1", name: "Subs", sourceId: "twitch", eventId: "sub", effects: effects(chat("ty")) }],
    });
    expect(both.items.map((item) => item.name)).toEqual(["Subs (new subs)", "Subs (resubs)"]);

    const resubOnly = convert({
      events: [
        {
          id: "e1",
          name: "Resubs",
          sourceId: "twitch",
          eventId: "sub",
          filterData: { filters: [{ type: "firebot:sub-kind", comparisonType: "is", value: "resub" }] },
          effects: effects(chat("$subMonths months!")),
        },
      ],
    });
    const workflow = only(resubOnly.items, "workflow");
    expect(workflow.spec.trigger.kind === "event" && workflow.spec.trigger.event).toBe("channel.resub");
    expect(workflow.spec.steps[0].kind === "action" && workflow.spec.steps[0].parameters.message).toBe(
      "${trigger.data.cumulativeMonths} months!"
    );
  });

  test("events of an inactive event set come over turned off", () => {
    const plan = convert({
      eventGroups: [
        {
          id: "g",
          name: "Off",
          active: false,
          events: [{ id: "e1", sourceId: "twitch", eventId: "follow", active: true, effects: effects(chat("ty")) }],
        },
      ],
    });
    expect(only(plan.items, "workflow").spec.enabled).toBe(false);
  });

  test("an event woofx3 has no trigger for cannot come over", () => {
    const plan = convert({
      events: [{ id: "e1", sourceId: "streamlabs", eventId: "donation", effects: effects(chat("ty")) }],
    });
    expect(itemReadiness(plan.items[0])).toBe("unsupported");
  });

  test("timers run on an interval schedule and note what they lose", () => {
    const plan = convert({
      timers: [
        {
          id: "t1",
          name: "Socials",
          active: true,
          interval: 900,
          requiredChatLines: 5,
          effects: effects(chat("follow!")),
        },
      ],
    });
    const workflow = only(plan.items, "workflow");
    expect(workflow.spec.trigger).toEqual({ kind: "schedule", schedule: "@every 900s" });
    expect(itemReadiness(workflow)).toBe("partial");
  });

  test("lists what has no place on woofx3", () => {
    const plan = convert({ currencies: { x: { id: "x", name: "Points" } }, hotkeys: [{ id: "h", name: "Scene 1" }] });
    expect(plan.leftovers.map((leftover) => `${leftover.origin}: ${leftover.name}`)).toEqual([
      "Firebot currency: Points",
      "Firebot hotkey: Scene 1",
    ]);
  });
});
