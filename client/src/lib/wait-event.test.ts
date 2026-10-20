import { describe, expect, test } from "bun:test";
import type { ConditionConfig } from "@woofx3/api";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import type { EventWaitConfig } from "@/lib/wait-config";
import {
  joinWaitConditions,
  newWaitCheck,
  readWaitCheck,
  resolveWaitEvent,
  searchWaitEvents,
  setWaitHowMany,
  splitWaitConditions,
  waitEventGroups,
  waitEventName,
  waitHowMany,
  waitSentence,
  writeWaitCheck,
} from "@/lib/wait-event";

function row(overrides: Partial<CatalogTriggerRow> & Pick<CatalogTriggerRow, "id" | "name">): CatalogTriggerRow {
  return { description: "", category: "", color: "", icon: "", ...overrides };
}

const cheer = row({
  id: "cheer",
  name: "Cheer",
  event: "channel.cheer",
  taxonomy: ["platform.twitch", "alert.cheer"],
  configFields: [{ id: "bits", label: "Bits", type: "number", unit: "bits", operator: "gte" }],
  emits: [
    { path: "bits", type: "number" },
    { path: "message", type: "string" },
    { path: "anonymous", type: "boolean" },
  ],
});
const counterChanged = row({
  id: "counter",
  name: "Counter changed",
  event: "counter.changed",
  taxonomy: ["system.counter"],
  sentence: "{counter} changes",
  configFields: [
    {
      id: "counter",
      label: "Counter",
      type: "resource_ref",
      resourceKind: "counter",
      eventPath: "target",
      operator: "eq",
    },
  ],
  emits: [
    { path: "target", type: "string" },
    { path: "next", type: "number" },
  ],
});
const chatCommand = row({
  id: "command",
  name: "Chat command",
  event: "chat.command.*",
  taxonomy: ["system.chat"],
  configFields: [{ id: "command", label: "Command", type: "text", required: true, placeholder: "hello" }],
});
const schedule = row({ id: "schedule", name: "On a schedule", event: "schedule.tick", transport: "schedule" });
const catalog = [cheer, counterChanged, chatCommand, schedule];

describe("waitEventGroups", () => {
  test("lists platforms first, then what the event is about, and leaves out events a wait can't receive", () => {
    const groups = waitEventGroups(catalog);
    expect(groups.map((group) => group.label)).toEqual(["Twitch", "Chat", "Counters"]);
    expect(groups.flatMap((group) => group.choices.map((choice) => choice.row.id))).not.toContain("schedule");
  });

  test("search matches names and groups", () => {
    const groups = waitEventGroups(catalog);
    expect(searchWaitEvents(groups, "cheer").map((choice) => choice.row.id)).toEqual(["cheer"]);
    expect(searchWaitEvents(groups, "counters").map((choice) => choice.row.id)).toEqual(["counter"]);
    expect(searchWaitEvents(groups, " ")).toEqual([]);
  });
});

describe("resolveWaitEvent", () => {
  test("finds an exact event", () => {
    expect(resolveWaitEvent("channel.cheer", catalog)?.choice.row.id).toBe("cheer");
    expect(resolveWaitEvent("", catalog)).toBeNull();
    expect(resolveWaitEvent("custom.thing", catalog)).toBeNull();
  });

  test("a wildcard event is filled with which one, and its naming setting is not a condition", () => {
    const resolved = resolveWaitEvent("chat.command.hug", catalog);
    expect(resolved?.choice.row.id).toBe("command");
    expect(resolved?.wildcardValue).toBe("hug");
    expect(resolved?.choice.wildcardField?.id).toBe("command");
    expect(resolved?.choice.fields).toEqual([]);
    expect(resolveWaitEvent("chat.command.*", catalog)?.wildcardValue).toBe("");
  });

  test("waitEventName fills the wildcard, or keeps the pattern until it is named", () => {
    const choice = resolveWaitEvent("chat.command.*", catalog)?.choice;
    if (!choice) {
      throw new Error("chat command not resolved");
    }
    expect(waitEventName(choice, "hug")).toBe("chat.command.hug");
    expect(waitEventName(choice, "")).toBe("chat.command.*");
  });
});

describe("splitWaitConditions", () => {
  const fields = resolveWaitEvent("channel.cheer", catalog)?.choice.fields ?? [];

  test("a setting's condition reads as the setting, and everything else stays a check", () => {
    const conditions: ConditionConfig[] = [
      { field: "${event.data.message}", operator: "contains", value: "hype" },
      { field: "${event.data.bits}", operator: "gte", value: 100 },
    ];
    const split = splitWaitConditions(fields, conditions);
    expect(split.values.bits).toBe(100);
    expect(split.checks).toEqual([conditions[0]]);
  });

  test("a condition the setting would not save back as written stays a check", () => {
    const conditions: ConditionConfig[] = [{ field: "${event.data.bits}", operator: "in", value: [1, 2] }];
    const split = splitWaitConditions(fields, conditions);
    expect(split.values.bits).toBeNull();
    expect(split.checks).toEqual(conditions);
    expect(joinWaitConditions(fields, split.values, split.checks)).toEqual(conditions);
  });

  test("split then join keeps every condition", () => {
    const conditions: ConditionConfig[] = [
      { field: "${event.data.bits}", operator: "gte", value: 100 },
      { field: "${event.data.bits}", operator: "lt", value: 1000 },
      { field: "${trigger.data.user}", operator: "eq", value: "x" },
    ];
    const split = splitWaitConditions(fields, conditions);
    expect(joinWaitConditions(fields, split.values, split.checks)).toEqual(conditions);
  });

  test("no settings and no checks save no conditions", () => {
    expect(joinWaitConditions(fields, splitWaitConditions(fields, []).values, [])).toBeUndefined();
  });
});

describe("checks", () => {
  const emits = resolveWaitEvent("channel.cheer", catalog)?.choice.emits ?? [];

  test("a new check starts with the field type's first comparison", () => {
    expect(newWaitCheck(emits[1])).toEqual({ field: "${event.data.message}", operator: "eq", value: "" });
    expect(newWaitCheck(emits[2])).toEqual({ field: "${event.data.anonymous}", operator: "eq", value: true });
  });

  test("reads and writes checks on payload fields, typing numbers", () => {
    const check = readWaitCheck({ field: "${event.data.bits}", operator: "gt", value: 5 }, emits);
    expect(check?.choice.label).toBe("is more than");
    if (!check) {
      throw new Error("not read");
    }
    expect(writeWaitCheck({ ...check, value: "50" })).toEqual({
      field: "${event.data.bits}",
      operator: "gt",
      value: 50,
    });
    expect(readWaitCheck({ field: "${event.data.anonymous}", operator: "eq", value: false }, emits)?.choice.id).toBe(
      "false"
    );
  });

  test("anything else is not read as a check", () => {
    expect(readWaitCheck({ field: "${event.type}", operator: "eq", value: "x" }, emits)).toBeNull();
    expect(readWaitCheck({ field: "${event.data.bits}", operator: "between", value: [1, 2] }, emits)).toBeNull();
    expect(readWaitCheck({ field: "${event.data.unknown}", operator: "eq", value: "x" }, emits)).toBeNull();
  });
});

describe("how many", () => {
  const base: EventWaitConfig = { type: "event", event: "channel.cheer", timeout: "5m" };
  const numeric = [{ path: "bits", type: "number" as const }];

  test("reads from the aggregation, as the engine does", () => {
    expect(waitHowMany(base)).toBe("first");
    expect(waitHowMany({ ...base, aggregation: { strategy: "sum", threshold: 1 } })).toBe("sum");
  });

  test("a total reads the event's first number, and the first one drops the aggregation", () => {
    const sum = setWaitHowMany(base, "sum", numeric);
    expect(sum).toEqual({
      type: "aggregation",
      event: "channel.cheer",
      timeout: "5m",
      aggregation: { strategy: "sum", threshold: 100, field: "data.bits" },
    });
    const count = setWaitHowMany(sum, "count", numeric);
    expect(count.aggregation).toEqual({ strategy: "count", threshold: 5 });
    expect(setWaitHowMany(count, "first", numeric)).toEqual(base);
  });

  test("keeps the window and threshold between totals", () => {
    const sum: EventWaitConfig = {
      ...base,
      type: "aggregation",
      aggregation: { strategy: "sum", threshold: 500, field: "data.bits", timeWindow: "2m" },
    };
    expect(setWaitHowMany(sum, "threshold", numeric).aggregation).toEqual({
      strategy: "threshold",
      threshold: 500,
      field: "data.bits",
      timeWindow: "2m",
    });
  });
});

describe("waitSentence", () => {
  test("reads the event, its settings, checks and how many", () => {
    const wait: EventWaitConfig = {
      type: "aggregation",
      event: "channel.cheer",
      conditions: [
        { field: "${event.data.bits}", operator: "gte", value: 100 },
        { field: "${event.data.message}", operator: "contains", value: "hype" },
      ],
      aggregation: { strategy: "sum", threshold: 500, field: "data.bits", timeWindow: "5m" },
    };
    expect(waitSentence(wait, catalog)).toBe(
      "Wait until cheer happens (Bits: 100 bits or more) where message contains “hype”, until the total of their bits reaches 500 within 5m"
    );
  });

  test("uses the trigger's sentence and the streamer's names for their things", () => {
    const wait: EventWaitConfig = {
      type: "aggregation",
      event: "counter.changed",
      conditions: [{ field: "${event.data.target}", operator: "eq", value: "woofx3:counter:hype" }],
      aggregation: { strategy: "count", threshold: 3 },
    };
    expect(waitSentence(wait, catalog, new Map([["woofx3:counter:hype", "Hype"]]))).toBe(
      "Wait until Hype changes 3 times"
    );
    expect(waitSentence({ type: "event", event: "counter.changed" }, catalog)).toBe("Wait until any counter changes");
  });

  test("an empty or unknown event still reads", () => {
    expect(waitSentence({ type: "event", event: "" }, catalog)).toBe("Wait for an event");
    expect(waitSentence({ type: "event", event: "custom.thing" }, catalog)).toBe("Wait until custom.thing happens");
    expect(waitSentence({ type: "event", event: "chat.command.hug" }, catalog)).toBe(
      "Wait until chat command hug happens"
    );
  });
});
