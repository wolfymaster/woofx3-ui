import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { SendToPlatformsParams } from "@woofx3/api/platform-gateway";
import { ConvexError } from "convex/values";
import { logger } from "../logger";
import type { EngineCapabilityReport } from "./engineCapabilities";
import type { EngineApi } from "./engineInstanceUrl";
import { EngineTimeoutError } from "./inboundWebhookRelay";
import {
  chooseChatRoute,
  type GatewaySendOutcome,
  idempotencyKeys,
  readGatewayResult,
  sendThroughGateway,
  undeliveredError,
} from "./platformGateway";
import { fakeGatewayRoute, twitchAnswer } from "./platformGateway.fakes";

let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  warn = spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

const SEND: SendToPlatformsParams = {
  action: "chat.send",
  platforms: ["twitch"],
  payload: { message: "hello chat" },
  idempotencyKey: "dashboard:op-12345678:chat.send",
};

describe("readGatewayResult", () => {
  const cases: Array<{ name: string; answer: unknown; outcome: GatewaySendOutcome }> = [
    {
      name: "delivered, with the posted message id",
      answer: twitchAnswer({ status: "delivered", messageId: "m1" }),
      outcome: { kind: "delivered", messageId: "m1" },
    },
    {
      name: "delivered without a message id",
      answer: twitchAnswer({ status: "delivered" }),
      outcome: { kind: "delivered", messageId: null },
    },
    {
      name: "dropped by Twitch",
      answer: twitchAnswer({ status: "dropped", reason: "Held by AutoMod" }),
      outcome: { kind: "dropped", reason: "Held by AutoMod" },
    },
    {
      name: "unconfirmed by Twitch",
      answer: twitchAnswer({ status: "unconfirmed", message: "Twitch did not answer" }),
      outcome: { kind: "unconfirmed", detail: "Twitch did not answer" },
    },
    {
      name: "Twitch turned off in the engine",
      answer: twitchAnswer({ status: "unavailable", reason: "disabled" }),
      outcome: { kind: "unavailable", detail: "Twitch is turned off in the engine" },
    },
    {
      name: "Twitch not linked",
      answer: twitchAnswer({ status: "unavailable", reason: "not_linked" }),
      outcome: { kind: "unavailable", detail: "Twitch isn't connected to the engine" },
    },
    {
      name: "refused by Twitch",
      answer: twitchAnswer({ status: "failed", code: "forbidden", message: "Twitch answered 403: missing scope" }),
      outcome: { kind: "failed", code: "forbidden", detail: "Twitch answered 403: missing scope", messageId: null },
    },
    {
      name: "posted but not pinned",
      answer: twitchAnswer({ status: "failed", code: "upstream", message: "posted but not pinned", messageId: "m2" }),
      outcome: { kind: "failed", code: "upstream", detail: "posted but not pinned", messageId: "m2" },
    },
    {
      name: "an action Twitch cannot do",
      answer: twitchAnswer({ status: "unsupported" }),
      outcome: { kind: "failed", code: null, detail: "Twitch can't do that", messageId: null },
    },
    {
      name: "a request the gateway refused whole",
      answer: { ok: true, reply: { ok: false, results: {}, error: { code: "invalid", message: "bad payload" } } },
      outcome: { kind: "failed", code: "invalid", detail: "bad payload", messageId: null },
    },
    {
      name: "a reply with nothing for Twitch",
      answer: { ok: true, reply: { ok: false, results: {} } },
      outcome: { kind: "failed", code: null, detail: "the gateway reported nothing for twitch", messageId: null },
    },
    {
      name: "the gateway not running",
      answer: { ok: false, code: "unavailable", error: "The platform gateway is not running" },
      outcome: { kind: "unavailable", detail: "The platform gateway is not running" },
    },
    {
      name: "a request the engine refused as invalid",
      answer: { ok: false, code: "invalid", error: "payload.message: is required" },
      outcome: { kind: "failed", code: "invalid", detail: "payload.message: is required", messageId: null },
    },
    {
      name: "the gateway's own timeout",
      answer: { ok: false, code: "timeout", error: "may have been sent" },
      outcome: { kind: "unconfirmed", detail: "may have been sent" },
    },
    {
      name: "a bus failure after the request left",
      answer: { ok: false, code: "failed", error: "connection closed" },
      outcome: { kind: "unconfirmed", detail: "connection closed" },
    },
    {
      name: "a failure code this dashboard does not know",
      answer: { ok: false, code: "melted", error: "?" },
      outcome: { kind: "unconfirmed", detail: 'unknown failure "melted": ?' },
    },
    {
      name: "no answer at all",
      answer: undefined,
      outcome: { kind: "unconfirmed", detail: "unreadable answer undefined" },
    },
    {
      name: "an answer without ok",
      answer: { reply: {} },
      outcome: { kind: "unconfirmed", detail: "unreadable answer" },
    },
    {
      name: "a reply that breaks the contract",
      answer: { ok: true, reply: { ok: true, results: { twitch: { status: "posted" } } } },
      outcome: { kind: "unconfirmed", detail: expect.stringContaining("unreadable reply: results.twitch") as never },
    },
  ];

  for (const { name, answer, outcome } of cases) {
    test(name, () => {
      expect(readGatewayResult(answer, "twitch")).toEqual(outcome);
    });
  }
});

describe("sendThroughGateway", () => {
  test("sends the request as given and reads the answer", async () => {
    const { route, calls } = fakeGatewayRoute(twitchAnswer({ status: "delivered", messageId: "m1" }));
    expect(await sendThroughGateway(route, SEND)).toEqual({ kind: "delivered", messageId: "m1" });
    expect(calls).toEqual([SEND]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("an engine that does not answer in time is unconfirmed", async () => {
    const { route } = fakeGatewayRoute(new EngineTimeoutError(15_000));
    expect(await sendThroughGateway(route, SEND)).toEqual({
      kind: "unconfirmed",
      detail: "the engine did not answer in time",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("a session that fails during the call may have posted", async () => {
    const { route } = fakeGatewayRoute(new TypeError("socket closed"));
    expect(await sendThroughGateway(route, SEND)).toEqual({
      kind: "unconfirmed",
      detail: "the engine connection failed: socket closed",
    });
  });

  test("an engine whose session cannot be opened sent nothing", async () => {
    const { route, calls } = fakeGatewayRoute(twitchAnswer({ status: "delivered" }));
    const unreachable = {
      ...route,
      engine: () => {
        throw new TypeError("fetch failed");
      },
    };
    expect(await sendThroughGateway(unreachable, SEND)).toEqual({
      kind: "unavailable",
      detail: "the engine could not be reached: fetch failed",
    });
    expect(calls).toHaveLength(0);
  });

  test("refuses anything but exactly one platform", async () => {
    const { route, calls } = fakeGatewayRoute(twitchAnswer({ status: "delivered" }));
    await expect(sendThroughGateway(route, { ...SEND, platforms: [] })).rejects.toThrow("exactly one platform");
    await expect(sendThroughGateway(route, { ...SEND, platforms: ["twitch", "twitch"] })).rejects.toThrow(
      "exactly one platform"
    );
    expect(calls).toEqual([]);
  });
});

describe("chooseChatRoute", () => {
  const engine = {} as EngineApi;
  const gate = (report: () => Promise<EngineCapabilityReport>) => ({
    instanceId: "instance-1",
    capability: "twitch.chat" as const,
    capabilities: report,
    session: () => engine,
  });

  test("an engine with platform.gateway gets the gateway", async () => {
    const route = await chooseChatRoute(
      gate(async () => ({ legacy: false, capabilities: ["platform.gateway", "twitch.chat"] }))
    );
    expect(route.kind).toBe("gateway");
    expect(route.kind === "gateway" && route.engine()).toBe(engine);
  });

  test("an engine without it keeps the Helix route through the engine", async () => {
    let asked = 0;
    const route = await chooseChatRoute(
      gate(async () => {
        asked += 1;
        return { legacy: false, capabilities: ["twitch.chat"] };
      })
    );
    expect(route.kind).toBe("helix");
    expect(route.kind === "helix" && route.helix.engine?.()).toBe(engine);
    expect(asked).toBe(1);
  });

  test("an older engine without twitch.chat calls Helix directly", async () => {
    const route = await chooseChatRoute(gate(async () => ({ legacy: true, capabilities: [] })));
    expect(route).toEqual({ kind: "helix", helix: { engine: null, instanceId: "instance-1" } });
  });

  test("an engine that cannot say what it supports calls Helix directly", async () => {
    const route = await chooseChatRoute(
      gate(async () => {
        throw new Error("engine down");
      })
    );
    expect(route).toEqual({ kind: "helix", helix: { engine: null, instanceId: "instance-1" } });
  });
});

describe("idempotencyKeys", () => {
  const neverCalled = () => {
    throw new Error("newId should not be called");
  };

  test("names each step of one intent under its operation id", () => {
    const keys = idempotencyKeys("dashboard", "op_12345678", neverCalled);
    expect(keys("chat.pin.existing")).toBe("dashboard:op_12345678:chat.pin.existing");
    expect(keys("chat.pin.new")).toBe("dashboard:op_12345678:chat.pin.new");
    expect(idempotencyKeys("golive", "8f14e45f-ceea-467f-a0e6-e4b2a1c0d3f9", neverCalled)("announce")).toBe(
      "golive:8f14e45f-ceea-467f-a0e6-e4b2a1c0d3f9:announce"
    );
  });

  test("a client without operation ids gets one fresh id for all its steps", () => {
    let made = 0;
    const keys = idempotencyKeys("dashboard", undefined, () => {
      made += 1;
      return `server-${made}`;
    });
    expect([keys("a"), keys("b")]).toEqual(["dashboard:server-1:a", "dashboard:server-1:b"]);
  });

  test("refuses an operation id it cannot put in a key", () => {
    for (const bad of ["", "short", "has spaces in it", "colon:inside:id", "x".repeat(65)]) {
      expect(() => idempotencyKeys("dashboard", bad, neverCalled)).toThrow(ConvexError);
    }
  });
});

describe("undeliveredError", () => {
  const cases: Array<{ outcome: Exclude<GatewaySendOutcome, { kind: "delivered" }>; sentence: string }> = [
    {
      outcome: { kind: "dropped", reason: "Held by AutoMod" },
      sentence: "Twitch didn't post the chat message: Held by AutoMod",
    },
    {
      outcome: { kind: "unconfirmed", detail: "the engine did not answer in time" },
      sentence:
        "Twitch didn't confirm the chat message (the engine did not answer in time), so it may already be in chat. Sending it again in the next few minutes won't post a second copy.",
    },
    {
      outcome: { kind: "unavailable", detail: "Twitch is turned off in the engine" },
      sentence: "The chat message wasn't sent: Twitch is turned off in the engine",
    },
    {
      outcome: { kind: "failed", code: "forbidden", detail: "missing scope", messageId: null },
      sentence: "Twitch refused the chat message: missing scope",
    },
  ];

  for (const { outcome, sentence } of cases) {
    test(outcome.kind, () => {
      const error = undeliveredError(outcome, "chat message");
      expect(error).toBeInstanceOf(ConvexError);
      expect(error.data).toBe(sentence);
    });
  }
});
