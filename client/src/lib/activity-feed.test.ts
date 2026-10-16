import { describe, expect, test } from "bun:test";
import { Zap } from "lucide-react";
import type { TriggerPreset } from "@/lib/workflow-presets";
import {
  type ActivityAlert,
  type ActivityEvent,
  eventTypeGroups,
  mergeActivity,
  triggersByEventType,
  withEventTypeEnabled,
} from "./activity-feed";

function event(id: string, type: string, time: string, overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return { id, type, source: "twitch", time, data: { userName: "ana" }, ...overrides };
}

function alert(
  id: string,
  options: { sourceEventId?: string; event?: Record<string, unknown> | null; createdAt?: string } = {}
): ActivityAlert {
  return {
    _id: id,
    _creationTime: 0,
    sourceEventId: options.sourceEventId,
    payload: JSON.stringify({ parameters: { target: "default" }, event: options.event ?? null }),
    engineCreatedAt: options.createdAt,
  };
}

const ALL = new Set(["channel.follow", "channel.cheer"]);

describe("mergeActivity", () => {
  test("shows enabled events newest first", () => {
    const rows = mergeActivity(
      [event("e1", "channel.follow", "2026-10-01T10:00:00Z"), event("e2", "channel.cheer", "2026-10-01T11:00:00Z")],
      [],
      ALL
    );
    expect(rows.map((row) => row.key)).toEqual(["e2", "e1"]);
    expect(rows[0].event).toEqual({ type: "channel.cheer", data: { userName: "ana" } });
    expect(rows[0].alerts).toEqual([]);
  });

  test("leaves out an event whose type is not enabled", () => {
    const rows = mergeActivity([event("e1", "channel.follow", "2026-10-01T10:00:00Z")], [], new Set(["channel.cheer"]));
    expect(rows).toEqual([]);
  });

  test("shows every event when no selection applies, as for an engine that predates it", () => {
    const rows = mergeActivity([event("e1", "stream.online", "2026-10-01T10:00:00Z")], [], null);
    expect(rows.map((row) => row.key)).toEqual(["e1"]);
  });

  test("keeps one copy of an event that history and the push both delivered", () => {
    const rows = mergeActivity(
      [event("e1", "channel.follow", "2026-10-01T10:00:00Z"), event("e1", "channel.follow", "2026-10-01T10:00:00Z")],
      [],
      ALL
    );
    expect(rows).toHaveLength(1);
  });

  test("attaches an alert to its event by sourceEventId instead of adding a row", () => {
    const played = alert("a1", { sourceEventId: "e1", createdAt: "2026-10-01T10:00:01Z" });
    const rows = mergeActivity([event("e1", "channel.follow", "2026-10-01T10:00:00Z")], [played], ALL);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("e1");
    expect(rows[0].alerts).toEqual([played]);
    expect(rows[0].time).toBe(Date.parse("2026-10-01T10:00:00Z"));
  });

  test("falls back to the id of the event the envelope carries", () => {
    const played = alert("a1", { event: { id: "e1", type: "channel.follow" } });
    const rows = mergeActivity([event("e1", "channel.follow", "2026-10-01T10:00:00Z")], [played], ALL);
    expect(rows).toHaveLength(1);
    expect(rows[0].alerts).toEqual([played]);
  });

  test("shows one row for an event that played several alerts, newest alert first", () => {
    const first = alert("a1", { sourceEventId: "e1", createdAt: "2026-10-01T10:00:01Z" });
    const second = alert("a2", { sourceEventId: "e1", createdAt: "2026-10-01T10:00:02Z" });
    const rows = mergeActivity([event("e1", "channel.follow", "2026-10-01T10:00:00Z")], [first, second], ALL);
    expect(rows).toHaveLength(1);
    expect(rows[0].alerts.map((a) => a._id)).toEqual(["a2", "a1"]);
  });

  test("shows an alert whose event type is switched off, worded from the event it carries", () => {
    const played = alert("a1", {
      sourceEventId: "e9",
      event: { id: "e9", type: "channel.raid", time: "2026-10-01T09:00:00Z", data: { fromBroadcasterUserName: "x" } },
    });
    const rows = mergeActivity([], [played], ALL);
    expect(rows).toEqual([
      {
        key: "e9",
        time: Date.parse("2026-10-01T09:00:00Z"),
        event: { type: "channel.raid", data: { fromBroadcasterUserName: "x" } },
        alerts: [played],
      },
    ]);
  });

  test("shows an alert with no source event on its own, at the alert's time", () => {
    const manual = alert("a1", { createdAt: "2026-10-01T12:00:00Z" });
    const rows = mergeActivity([event("e1", "channel.follow", "2026-10-01T10:00:00Z")], [manual], ALL);
    expect(rows.map((row) => row.key)).toEqual(["alert:a1", "e1"]);
    expect(rows[0].event).toBeNull();
  });

  test("drops test events and test alerts, which the dashboard fired itself", () => {
    const testAlert = alert("a1", { event: { id: "e2", type: "channel.follow", source: "api" } });
    const rows = mergeActivity(
      [
        event("e1", "channel.follow", "2026-10-01T10:00:00Z", { source: "api" }),
        event("e3", "channel.follow", "2026-10-01T10:00:00Z"),
      ],
      [testAlert],
      ALL
    );
    expect(rows.map((row) => row.key)).toEqual(["e3"]);
  });

  test("keeps a replay of a real alert, which carries the real event", () => {
    const original = alert("a1", {
      sourceEventId: "e1",
      event: { id: "e1", source: "twitch", type: "channel.follow" },
    });
    const replay = alert("a2", { sourceEventId: "e1", event: { id: "e1", source: "twitch", type: "channel.follow" } });
    const rows = mergeActivity([], [original, replay], ALL);
    expect(rows).toHaveLength(1);
    expect(rows[0].alerts).toHaveLength(2);
  });
});

function preset(overrides: Partial<TriggerPreset>): TriggerPreset {
  return {
    id: "t1",
    name: "Trigger",
    description: "",
    icon: Zap,
    category: "General",
    color: "#888888",
    event: "channel.follow",
    ...overrides,
  };
}

const follow = preset({
  id: "follow",
  canonicalRef: "twitch:trigger:follow",
  name: "Follow",
  event: "channel.follow",
  taxonomy: ["platform.twitch", "alert.follow"],
  source: "Twitch",
});
const adBreak = preset({
  id: "ad",
  name: "Ad break",
  event: "channel.ad_break.begin",
  taxonomy: ["platform.twitch"],
  source: "Twitch",
});

describe("withEventTypeEnabled", () => {
  const defaults = ["channel.follow", "channel.cheer"];
  const none = { shown: [], hidden: [] };

  test("turning a default on removes it from hidden", () => {
    expect(withEventTypeEnabled({ shown: [], hidden: ["channel.follow"] }, defaults, "channel.follow", true)).toEqual(
      none
    );
  });

  test("turning a non-default on adds it to shown, and takes it out of hidden", () => {
    expect(withEventTypeEnabled(none, defaults, "channel.ad_break.begin", true)).toEqual({
      shown: ["channel.ad_break.begin"],
      hidden: [],
    });
    expect(
      withEventTypeEnabled({ shown: [], hidden: ["channel.ad_break.begin"] }, defaults, "channel.ad_break.begin", true)
    ).toEqual({ shown: ["channel.ad_break.begin"], hidden: [] });
  });

  test("turning a default off adds it to hidden", () => {
    expect(withEventTypeEnabled(none, defaults, "channel.cheer", false)).toEqual({
      shown: [],
      hidden: ["channel.cheer"],
    });
  });

  test("turning a non-default off removes it from shown", () => {
    expect(
      withEventTypeEnabled({ shown: ["channel.ad_break.begin"], hidden: [] }, defaults, "channel.ad_break.begin", false)
    ).toEqual(none);
  });

  test("leaves every other override alone and never duplicates one", () => {
    const selection = { shown: ["wheel.landed"], hidden: ["channel.follow"] };
    expect(withEventTypeEnabled(selection, defaults, "channel.follow", false)).toEqual(selection);
    expect(withEventTypeEnabled(selection, defaults, "wheel.landed", true)).toEqual(selection);
  });
});

describe("eventTypeGroups", () => {
  test("names each offered type by its trigger and groups it by module", () => {
    const kofi = preset({ id: "kofi", name: "Donation", event: "kofi.donation", source: "Ko-fi" });
    const groups = eventTypeGroups(
      ["channel.follow", "kofi.donation", "channel.ad_break.begin", "mystery.event"],
      triggersByEventType([follow, adBreak, kofi])
    );
    expect(groups).toEqual([
      { source: "Ko-fi", types: [{ type: "kofi.donation", label: "Donation" }] },
      { source: "Other", types: [{ type: "mystery.event", label: "mystery.event" }] },
      {
        source: "Twitch",
        types: [
          { type: "channel.ad_break.begin", label: "Ad break" },
          { type: "channel.follow", label: "Follow" },
        ],
      },
    ]);
  });

  test("names a type by its eventbus trigger when another kind claims it too", () => {
    const command = { ...follow, id: "cmd", name: "Follow command", transport: "command" };
    expect(triggersByEventType([command, follow]).get("channel.follow")?.id).toBe("follow");
    expect(triggersByEventType([follow, command]).get("channel.follow")?.id).toBe("follow");
  });
});
