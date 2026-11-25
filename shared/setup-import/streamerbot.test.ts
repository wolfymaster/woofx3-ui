import { describe, expect, test } from "bun:test";
import type { JsonRecord } from "./read";
import { convertStreamerbot } from "./streamerbot";
import { type ImportItem, itemReadiness } from "./types";

function sendMessage(text: string, index = 0): JsonRecord {
  return { id: crypto.randomUUID(), type: 10, text, useBot: true, enabled: true, index };
}

function action(id: string, name: string, triggers: JsonRecord[], subActions: JsonRecord[]): JsonRecord {
  return { id, name, group: "", enabled: true, randomAction: false, triggers, subActions };
}

function convert(data: JsonRecord) {
  return convertStreamerbot({ name: "file", export: { version: 23, meta: { name: "My export" }, data } });
}

function workflows(items: ImportItem[]) {
  return items.filter((item): item is Extract<ImportItem, { kind: "workflow" }> => item.kind === "workflow");
}

describe("convertStreamerbot", () => {
  test("an action on a Twitch event becomes a workflow on the matching woofx3 event", () => {
    const plan = convert({
      actions: [
        action(
          "a1",
          "Raid thanks",
          [{ id: "t1", type: 107, enabled: true, min: 5, max: -1 }],
          [sendMessage("Thanks %user% for raiding with %viewers%!")]
        ),
      ],
    });
    expect(plan.label).toBe("My export");
    const [workflow] = workflows(plan.items);
    expect(workflow.spec.trigger).toEqual({
      kind: "event",
      event: "channel.raid",
      conditions: [{ field: "${trigger.data.viewers}", operator: "gte", value: 5 }],
      logic: "and",
    });
    expect(workflow.spec.steps).toEqual([
      {
        kind: "action",
        label: "Send chat message",
        ref: "woofx3:action:chat.reply",
        parameters: {
          message: "Thanks ${trigger.data.fromBroadcasterUserName} for raiding with ${trigger.data.viewers}!",
        },
      },
    ]);
    expect(itemReadiness(workflow)).toBe("ready");
  });

  test("a command runs the actions whose command trigger names it", () => {
    const plan = convert({
      commands: [
        {
          id: "cmd1",
          command: "!lurk\n!brb",
          enabled: true,
          mode: 0,
          location: 0,
          globalCooldown: 10,
          permittedGroups: ["Moderators"],
          permittedUsers: ["Friend"],
        },
      ],
      actions: [
        action(
          "a1",
          "Lurk",
          [{ id: "t", type: 401, commandId: "cmd1", enabled: true }],
          [sendMessage("%user% is lurking")]
        ),
      ],
    });
    const commands = plan.items.filter((item) => item.kind === "command");
    expect(commands.map((item) => item.kind === "command" && item.spec.command)).toEqual(["lurk", "brb"]);
    const [lurk] = commands;
    expect(lurk.kind === "command" && lurk.spec.cooldown).toBe(10);
    expect(lurk.kind === "command" && lurk.spec.access).toEqual({
      builtIn: ["moderator"],
      groupKeys: [],
      usernames: ["friend"],
    });
    expect(lurk.kind === "command" && lurk.spec.steps[0].parameters.message).toBe("${trigger.data.chatter} is lurking");
    expect(workflows(plan.items)).toEqual([]);
  });

  test("custom user groups become groups, VIP-only stays closed", () => {
    const plan = convert({
      commands: [
        { id: "c1", command: "!club", permittedGroups: ["Regulars"] },
        { id: "c2", command: "!vip", permittedGroups: ["VIPs"] },
      ],
      actions: [
        action("a1", "Club", [{ id: "t1", type: 401, commandId: "c1" }], [sendMessage("in")]),
        action("a2", "Vip", [{ id: "t2", type: 401, commandId: "c2" }], [sendMessage("in")]),
      ],
    });
    const group = plan.items.find((item) => item.kind === "group");
    expect(group?.name).toBe("Regulars");
    const vip = plan.items.find((item) => item.kind === "command" && item.spec.command === "vip");
    expect(vip?.kind === "command" && vip.spec.access.builtIn).toEqual(["broadcaster", "moderator"]);
  });

  test("timed actions become interval schedules", () => {
    const plan = convert({
      timers: [{ id: "tm", name: "Socials", enabled: true, repeat: true, interval: 600, lines: 0 }],
      actions: [action("a1", "Socials", [{ id: "t", type: 701, timerId: "tm" }], [sendMessage("Follow me")])],
    });
    const [workflow] = workflows(plan.items);
    expect(workflow.spec.trigger).toEqual({ kind: "schedule", schedule: "@every 600s" });
  });

  test("if/else branches, delays, groups and run-action are carried over", () => {
    const plan = convert({
      actions: [
        action("helper", "Helper", [], [sendMessage("from helper")]),
        action(
          "a1",
          "Follow",
          [{ id: "t", type: 101 }],
          [
            {
              id: "if",
              type: 120,
              index: 0,
              enabled: true,
              input: "%user%",
              operation: 0,
              value: "wolfy",
              subActions: [
                { type: 99901, subActions: [sendMessage("boss")] },
                { type: 99902, subActions: [{ id: "d", type: 1002, value: "1500", index: 0 }] },
              ],
            },
            { id: "g", type: 99900, index: 1, random: false, subActions: [sendMessage("in group")] },
            { id: "r", type: 4, index: 2, actionId: "helper" },
          ]
        ),
      ],
    });
    const [workflow] = workflows(plan.items);
    expect(workflow.spec.steps.map((step) => step.kind)).toEqual(["branch", "action", "action"]);
    const [branch] = workflow.spec.steps;
    expect(branch.kind === "branch" && branch.conditions).toEqual([
      { field: "${trigger.data.userName}", operator: "eq", value: "wolfy" },
    ]);
    expect(branch.kind === "branch" && branch.whenFalse).toEqual([{ kind: "delay", label: "Wait 1.5s", ms: 1500 }]);
    expect(plan.leftovers).toEqual([]);
  });

  test("the flat sub-action list of older exports is read in group order", () => {
    const plan = convertStreamerbot({
      name: "old",
      export: {
        version: 11,
        meta: { name: "Old" },
        data: {
          actions: [
            {
              id: "a1",
              name: "Old follow",
              enabled: true,
              triggers: [{ id: "t", type: 101 }],
              actions: [
                { ...sendMessage("second", 1), group: "" },
                { ...sendMessage("first", 0), group: "G" },
              ],
              actionGroups: [{ id: "g", name: "G", random: false, index: 0 }],
            },
          ],
        },
      },
    });
    const [workflow] = workflows(plan.items);
    expect(workflow.spec.steps.map((step) => (step.kind === "action" ? step.parameters.message : null))).toEqual([
      "first",
      "second",
    ]);
  });

  test("C# code is left out with its source attached", () => {
    const source = "public class CPHInline { public bool Execute() { return true; } }";
    const plan = convert({
      actions: [
        action(
          "a1",
          "Coded",
          [{ id: "t", type: 101 }],
          [{ id: "c", type: 99999, name: "Thing", byteCode: btoa(source), index: 0 }, sendMessage("hi", 1)]
        ),
      ],
    });
    const [workflow] = workflows(plan.items);
    expect(workflow.notes[0].detail).toBe(source);
    expect(itemReadiness(workflow)).toBe("partial");
  });

  test("triggers without a woofx3 equivalent cannot come over, and untriggered actions are listed", () => {
    const plan = convert({
      actions: [
        action("a1", "First words", [{ id: "t", type: 120 }], [sendMessage("welcome")]),
        action("a2", "Manual", [], [sendMessage("hi")]),
      ],
    });
    expect(plan.items.map(itemReadiness)).toEqual(["unsupported"]);
    expect(plan.leftovers.map((leftover) => leftover.name)).toEqual(["Manual"]);
  });
});
