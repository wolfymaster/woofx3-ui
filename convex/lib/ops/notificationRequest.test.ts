import { describe, expect, it } from "bun:test";
import { parseNotificationRequest } from "./notificationRequest";

const valid = {
  requestId: "r1",
  heading: "Engine v0.4.0",
  description: "A new engine release is available.",
  link: "/admin/engine",
  audience: { kind: "all" },
};

describe("parseNotificationRequest", () => {
  it("accepts each audience", () => {
    expect(parseNotificationRequest(valid)).toEqual({
      ok: true,
      value: { ...valid, actionLabel: null, audience: { kind: "all" } },
    });
    expect(parseNotificationRequest({ ...valid, actionLabel: "Upgrade engine" })).toMatchObject({
      ok: true,
      value: { actionLabel: "Upgrade engine" },
    });
    expect(parseNotificationRequest({ ...valid, audience: { kind: "account", accountId: "k1" } })).toMatchObject({
      ok: true,
      value: { audience: { kind: "account", accountId: "k1" } },
    });
    expect(parseNotificationRequest({ ...valid, audience: { kind: "user", userId: "u1" } })).toMatchObject({
      ok: true,
      value: { audience: { kind: "user", userId: "u1" } },
    });
  });

  it("refuses a missing requestId, bad content or a bad audience", () => {
    expect(parseNotificationRequest(null).ok).toBe(false);
    expect(parseNotificationRequest({ ...valid, requestId: "" }).ok).toBe(false);
    expect(parseNotificationRequest({ ...valid, heading: "x".repeat(51) }).ok).toBe(false);
    expect(parseNotificationRequest({ ...valid, audience: { kind: "account" } }).ok).toBe(false);
    expect(parseNotificationRequest({ ...valid, audience: { kind: "everyone" } }).ok).toBe(false);
    expect(parseNotificationRequest({ ...valid, audience: undefined }).ok).toBe(false);
  });
});
