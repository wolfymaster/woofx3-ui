import type { GatewayReply, PlatformOutcome, SendToPlatformsParams } from "@woofx3/api/platform-gateway";
import type { EngineApi } from "./engineInstanceUrl";
import type { ChatRoute } from "./platformGateway";

// Test doubles for code that writes through convex/lib/platformGateway.ts.
// The second dot in the file name keeps Convex from deploying it, as it does
// for *.test.ts.

export type GatewayRoute = Extract<ChatRoute, { kind: "gateway" }>;

/**
 * A gateway route whose engine answers `sendToPlatforms` with `answer` (or
 * rejects with it, when it is an Error) and records each request.
 */
export function fakeGatewayRoute(answer: unknown | ((params: SendToPlatformsParams) => unknown)): {
  route: GatewayRoute;
  calls: SendToPlatformsParams[];
} {
  const calls: SendToPlatformsParams[] = [];
  const engine = {
    sendToPlatforms: async (params: SendToPlatformsParams) => {
      calls.push(params);
      const value = typeof answer === "function" ? answer(params) : answer;
      if (value instanceof Error) {
        throw value;
      }
      return value;
    },
  } as unknown as EngineApi;
  return { route: { kind: "gateway", instanceId: "instance-1", engine: () => engine }, calls };
}

/** The engine's answer when the gateway replied with `outcome` for Twitch. */
export function twitchAnswer(outcome: PlatformOutcome): { ok: true; reply: GatewayReply } {
  return { ok: true, reply: { ok: outcome.status === "delivered", results: { twitch: outcome } } };
}
