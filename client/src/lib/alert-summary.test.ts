import { describe, expect, test } from "bun:test";
import type { ConfigField, DataShapeField } from "@woofx3/api/ui-schema";
import { type AlertSummarySource, describeAlert } from "./alert-summary";

function payload(type: string | null, data?: Record<string, unknown>, target = "default"): string {
  return JSON.stringify({ parameters: { target }, event: type ? { type, data } : null });
}

const redeemFields: DataShapeField[] = [
  { path: "userId", type: "string", identity: "viewer", displayName: "userName" },
  { path: "userName", type: "string" },
  { path: "rewardTitle", type: "string" },
  { path: "message", type: "string" },
];

const redeem: AlertSummarySource = {
  name: "Channel point redemption",
  emits: redeemFields,
  summary: "{userName} redeemed {rewardTitle}",
  summaryDetails: ["“{message}”"],
};

const tierField: ConfigField = {
  id: "tier",
  label: "Tier",
  type: "select",
  options: [
    { value: "1000", label: "Tier 1" },
    { value: "2000", label: "Tier 2" },
  ],
};

const resub: AlertSummarySource = {
  name: "Channel resub",
  emits: [
    { path: "chatterId", type: "string", identity: "viewer", displayName: "chatterName" },
    { path: "chatterName", type: "string" },
    { path: "cumulativeMonths", type: "number" },
    { path: "streakMonths", type: "number" },
    { path: "tier", type: "string" },
  ],
  summary: "{chatterName} resubscribed for {cumulativeMonths} months",
  summaryDetails: ["{tier}", "{streakMonths}-month streak"],
  config: { fields: [tierField] },
};

const gift: AlertSummarySource = {
  name: "Channel subscription gift",
  emits: [
    { path: "gifterId", type: "string", identity: "viewer", anonymousWhen: "isAnonymous", displayName: "gifterName" },
    { path: "gifterName", type: "string" },
    { path: "isAnonymous", type: "boolean" },
    { path: "amount", type: "number" },
  ],
  summary: "{gifterName} gifted {amount} subs",
};

describe("describeAlert", () => {
  test("reads as the trigger's summary, filled from the event", () => {
    const summary = describeAlert(
      payload("channelpoints.redeem", { userName: "wolfy_fan", rewardTitle: "Hydrate", message: "drink water" }),
      redeem
    );
    expect(summary).toEqual({ title: "wolfy_fan redeemed Hydrate", details: ["“drink water”"] });
  });

  test("drops a detail whose value the event does not carry", () => {
    const summary = describeAlert(
      payload("channelpoints.redeem", { userName: "wolfy_fan", rewardTitle: "Hydrate" }),
      redeem
    );
    expect(summary.details).toEqual([]);
  });

  test("reads a value a select field lists as that option's label", () => {
    const summary = describeAlert(
      payload("channel.resub", { chatterName: "cozybear", cumulativeMonths: 14, streakMonths: 6, tier: "1000" }),
      resub
    );
    expect(summary).toEqual({
      title: "cozybear resubscribed for 14 months",
      details: ["Tier 1", "6-month streak"],
    });
  });

  test("keeps a value no option lists as it is", () => {
    const summary = describeAlert(
      payload("channel.resub", { chatterName: "c", cumulativeMonths: 2, tier: "prime" }),
      resub
    );
    expect(summary.details).toEqual(["prime"]);
  });

  test("names an identity the event withholds as Anonymous", () => {
    const summary = describeAlert(
      payload("channel.subscriptionGift", { gifterName: "ananonymousgifter", isAnonymous: true, amount: 5 }),
      gift
    );
    expect(summary.title).toBe("Anonymous gifted 5 subs");
  });

  test("reads an identity's id placeholder as its display name", () => {
    const summary = describeAlert(payload("channel.follow", { userId: "123", userName: "newpup" }), {
      name: "Channel follow",
      emits: redeemFields,
      summary: "{userId} followed",
    });
    expect(summary.title).toBe("newpup followed");
  });

  test("falls back to who and the trigger name when the summary cannot be filled", () => {
    const summary = describeAlert(payload("channelpoints.redeem", { userName: "wolfy_fan" }), redeem);
    expect(summary.title).toBe("wolfy_fan · Channel point redemption");
  });

  test("falls back to who and the trigger name for a trigger with no summary", () => {
    const summary = describeAlert(payload("channel.follow", { userId: "1", userName: "newpup" }), {
      name: "Channel follow",
      emits: redeemFields,
    });
    expect(summary).toEqual({ title: "newpup · Channel follow", details: [] });
  });

  test("does not fill a placeholder with a boolean, list or object", () => {
    const summary = describeAlert(payload("x", { userName: "a", rewardTitle: true }), redeem);
    expect(summary.title).toBe("a · Channel point redemption");
  });

  test("reads nested paths", () => {
    const summary = describeAlert(payload("x", { user: { name: "deep" } }), {
      name: "X",
      emits: [{ path: "user.name", type: "string" }],
      summary: "{user.name} did it",
    });
    expect(summary.title).toBe("deep did it");
  });

  test("reads as the trigger name when the alert has no event data", () => {
    expect(describeAlert(payload("channel.follow"), redeem).title).toBe("Channel point redemption");
  });

  test("reads as the event type, then the target, when no trigger claims it", () => {
    expect(describeAlert(payload("channel.follow", { userName: "a" }), undefined).title).toBe("channel.follow");
    expect(describeAlert(payload(null, undefined, "fullscreen"), undefined).title).toBe("Alert → fullscreen");
    expect(describeAlert(undefined, undefined).title).toBe("Alert");
  });
});
