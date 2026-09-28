import { describe, expect, test } from "bun:test";
import {
  findStarterPack,
  STARTER_ACTION_REFS,
  type StarterCatalog,
  type StarterPack,
  starterItemKey,
  starterPackDefaults,
} from "@convex/lib/starterPacks";
import { starterItemView, starterPackSummary, starterStepLabel } from "./starter-pack-view";

const TWITCH_TRIGGERS = [
  "channel.follow",
  "channel.raid",
  "channel.subscribe",
  "channel.resub",
  "channel.subscriptionGift",
];

const CHAT_ONLY: StarterCatalog = {
  triggers: TWITCH_TRIGGERS.map((event) => ({ event })),
  actions: [{ canonicalRef: STARTER_ACTION_REFS.chatReply, handlerType: "chat.reply" }],
};

function pack(id: string): StarterPack {
  const found = findStarterPack(id);
  if (!found) {
    throw new Error(`no pack ${id}`);
  }
  return found;
}

describe("starterItemView", () => {
  test("an installed item stays installed when the catalog no longer has what it needs", () => {
    const raid = pack("raid-welcome");
    const item = raid.items[0];
    const states = { [starterItemKey(raid.id, item.id)]: "installed" as const };
    expect(starterItemView(raid, item, CHAT_ONLY, states)).toEqual({ state: "installed" });
  });

  test("an item the engine cannot run yet is held back", () => {
    const raid = pack("raid-welcome");
    expect(starterItemView(raid, raid.items[0], CHAT_ONLY, {})).toEqual({
      state: "unavailable",
      reason: "Requires engine update",
    });
  });

  test("a command whose name is taken is a conflict", () => {
    const handy = pack("handy-commands");
    const lurk = handy.items[1];
    const states = { [starterItemKey(handy.id, lurk.id)]: "conflict" as const };
    expect(starterItemView(handy, lurk, CHAT_ONLY, states)).toEqual({
      state: "conflict",
      reason: "Name already taken",
    });
  });
});

describe("starterPackSummary", () => {
  test("a pack with some items ready is installable, and reports no block", () => {
    const subs = pack("sub-hype");
    const views = subs.items.map((item) => starterItemView(subs, item, CHAT_ONLY, {}));
    expect(starterPackSummary(views)).toEqual({ total: 4, installed: 0, ready: 3, blockedReason: null });
  });

  test("a pack with nothing ready names the reason", () => {
    const brb = pack("brb-scene");
    const views = brb.items.map((item) => starterItemView(brb, item, CHAT_ONLY, {}));
    expect(starterPackSummary(views).blockedReason).toBe("Requires engine update");
  });

  test("a fully installed pack is not blocked", () => {
    expect(starterPackSummary([{ state: "installed" }])).toEqual({
      total: 1,
      installed: 1,
      ready: 0,
      blockedReason: null,
    });
  });
});

describe("starterStepLabel", () => {
  const raid = pack("raid-welcome");
  const item = raid.items[0];
  const delay = item.steps[1];

  test("names the pause with its length, and drops a pause of zero", () => {
    expect(starterStepLabel(delay, { ...starterPackDefaults(raid), shoutoutDelaySeconds: 5 })).toBe("Pause 5 seconds");
    expect(starterStepLabel(delay, { ...starterPackDefaults(raid), shoutoutDelaySeconds: 1 })).toBe("Pause 1 second");
    expect(starterStepLabel(delay, { ...starterPackDefaults(raid), shoutoutDelaySeconds: 0 })).toBeNull();
  });
});
