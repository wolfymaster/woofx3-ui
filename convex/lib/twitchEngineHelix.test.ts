import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { TwitchHelixResult } from "@woofx3/api";
import { type FunctionReference, getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import { logger } from "../logger";
import type { EngineCapabilityReport } from "./engineCapabilities";
import type { EngineApi } from "./engineInstanceUrl";
import { EngineTimeoutError } from "./inboundWebhookRelay";
import {
  chooseTwitchHelixRoute,
  directHelixRoute,
  type HelixRequest,
  helixResponse,
  type TwitchHelixRoute,
  twitchHelixRoute,
} from "./twitchEngineHelix";

const DIRECT_BODY = JSON.stringify({ data: ["direct"] });

function routeAnswering(answer: () => Promise<TwitchHelixResult>): TwitchHelixRoute {
  const engine = { twitchGetChannelInformation: answer } as unknown as EngineApi;
  return { engine: () => engine, instanceId: "instance-1" };
}

function request(kind: "read" | "write") {
  const direct = mock(async () => new Response(DIRECT_BODY, { status: 200 }));
  const helixRequest: HelixRequest = {
    operation: "getChannelInformation",
    kind,
    viaEngine: (engine) => engine.twitchGetChannelInformation(),
    direct,
  };
  return { helixRequest, direct };
}

let warn: ReturnType<typeof spyOn>;
let error: ReturnType<typeof spyOn>;

beforeEach(() => {
  warn = spyOn(logger, "warn").mockImplementation(() => {});
  error = spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe("chooseTwitchHelixRoute", () => {
  const session = () => ({}) as EngineApi;
  const report = (capabilities: EngineCapabilityReport["capabilities"]): EngineCapabilityReport => ({
    legacy: false,
    capabilities,
  });

  test("calls Helix directly when the engine does not advertise the capability", async () => {
    const route = await chooseTwitchHelixRoute({
      instanceId: "instance-1",
      capability: "twitch.streamInfo",
      capabilities: async () => report(["obs.status"]),
      session,
    });
    expect(route.engine).toBeNull();
  });

  test("calls Helix directly for an engine that predates capabilities", async () => {
    const route = await chooseTwitchHelixRoute({
      instanceId: "instance-1",
      capability: "twitch.streamInfo",
      capabilities: async () => ({ legacy: true, capabilities: [] }),
      session,
    });
    expect(route.engine).toBeNull();
  });

  test("calls Helix directly, and says so, when the engine cannot say what it supports", async () => {
    const route = await chooseTwitchHelixRoute({
      instanceId: "instance-1",
      capability: "twitch.streamInfo",
      capabilities: async () => {
        throw new TypeError("fetch failed");
      },
      session,
    });
    expect(route.engine).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("uses the engine that advertises the capability", async () => {
    const route = await chooseTwitchHelixRoute({
      instanceId: "instance-1",
      capability: "twitch.streamInfo",
      capabilities: async () => report(["twitch.streamInfo"]),
      session,
    });
    expect(route.engine).toBe(session);
  });
});

describe("twitchHelixRoute", () => {
  function ctxAnswering(answers: Record<string, unknown>) {
    const asked: string[] = [];
    const ctx = {
      runQuery: async (query: FunctionReference<"query", "internal">) => {
        const name = getFunctionName(query);
        asked.push(name);
        return answers[name];
      },
    } as unknown as ActionCtx;
    return { ctx, asked };
  }
  const instanceId = "instance-1" as Parameters<typeof twitchHelixRoute>[1];

  test("a switch whose flag is off calls Helix without asking the engine anything", async () => {
    const { ctx, asked } = ctxAnswering({ "featureFlags:isOnForInstance": false });
    const route = await twitchHelixRoute(ctx, instanceId, "twitch.moderation", "twitch.engineModeration");
    expect(route.engine).toBeNull();
    expect(asked).toEqual(["featureFlags:isOnForInstance"]);
  });

  test("an instance not registered with its engine calls Helix", async () => {
    const { ctx } = ctxAnswering({
      "featureFlags:isOnForInstance": true,
      "instances:getInternal": { url: "https://engine.example", clientId: undefined, clientSecret: undefined },
    });
    const route = await twitchHelixRoute(ctx, instanceId, "twitch.moderation", "twitch.engineModeration");
    expect(route.engine).toBeNull();
  });
});

describe("helixResponse", () => {
  test("a direct route only fetches", async () => {
    const { helixRequest, direct } = request("read");
    const response = await helixResponse(directHelixRoute("instance-1"), helixRequest);
    expect(await response.text()).toBe(DIRECT_BODY);
    expect(direct).toHaveBeenCalledTimes(1);
  });

  test("Twitch's body comes back as JSON with a 2xx", async () => {
    const { helixRequest, direct } = request("read");
    const body = { data: [{ broadcaster_id: "1", title: "hi" }] };
    const response = await helixResponse(
      routeAnswering(async () => ({ ok: true, body })),
      helixRequest
    );
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual(body);
    expect(direct).not.toHaveBeenCalled();
  });

  test("an empty body comes back as a 204", async () => {
    const { helixRequest } = request("write");
    const response = await helixResponse(
      routeAnswering(async () => ({ ok: true, body: null })),
      helixRequest
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  test("Twitch's error status and body come back as they were sent", async () => {
    const { helixRequest, direct } = request("write");
    const body = '{"error":"Bad Request","status":400,"message":"The tag contains an invalid character"}';
    const response = await helixResponse(
      routeAnswering(async () => ({ ok: false, code: "helix", error: "Twitch answered 400", status: 400, body })),
      helixRequest
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(body);
    expect(direct).not.toHaveBeenCalled();
  });

  for (const kind of ["read", "write"] as const) {
    for (const code of ["not_linked", "unavailable"] as const) {
      test(`a ${kind} the engine could not send (${code}) goes to Helix, logged`, async () => {
        const { helixRequest, direct } = request(kind);
        const response = await helixResponse(
          routeAnswering(async () => ({ ok: false, code, error: "no" })),
          helixRequest
        );
        expect(await response.text()).toBe(DIRECT_BODY);
        expect(direct).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
      });
    }

    test(`a ${kind} the engine refused as invalid goes to Helix, logged as a bug`, async () => {
      const { helixRequest, direct } = request(kind);
      await helixResponse(
        routeAnswering(async () => ({ ok: false, code: "invalid_arguments", error: "unknown parameter" })),
        helixRequest
      );
      expect(direct).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    });

    test(`a ${kind} to an unreachable engine goes to Helix, logged`, async () => {
      const { helixRequest, direct } = request(kind);
      await helixResponse(
        routeAnswering(async () => {
          throw new TypeError("fetch failed");
        }),
        helixRequest
      );
      expect(direct).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  }

  const unconfirmed: Array<[string, () => Promise<TwitchHelixResult>, number]> = [
    ["timeout", async () => ({ ok: false, code: "timeout", error: "no answer in 10s" }), 504],
    ["failed", async () => ({ ok: false, code: "failed", error: "Twitch unreachable" }), 502],
    [
      "an engine that never answers",
      async () => {
        throw new EngineTimeoutError(15_000);
      },
      504,
    ],
    ["an unreadable answer", async () => ({ nonsense: true }) as unknown as TwitchHelixResult, 502],
    ["a 2xx dressed as an error", async () => ({ ok: false, code: "helix", error: "?", status: 200, body: "" }), 502],
  ];

  for (const [name, answer] of unconfirmed) {
    test(`a read after ${name} goes to Helix, logged`, async () => {
      const { helixRequest, direct } = request("read");
      const response = await helixResponse(routeAnswering(answer), helixRequest);
      expect(await response.text()).toBe(DIRECT_BODY);
      expect(direct).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  }

  for (const [name, answer, status] of unconfirmed) {
    test(`a write after ${name} is not resent and fails as Twitch ${status}`, async () => {
      const { helixRequest, direct } = request("write");
      const response = await helixResponse(routeAnswering(answer), helixRequest);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
      expect(direct).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  }
});
