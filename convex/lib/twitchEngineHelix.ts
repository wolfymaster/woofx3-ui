import { readHelixResult, type UnconfirmedReason, unconfirmedResponse } from "@shared/twitch-helix-answer";
import type { TwitchHelixResult } from "@woofx3/api";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { logger } from "../logger";
import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";
import { EngineTimeoutError, withEngineTimeout } from "./inboundWebhookRelay";

// The one place a dashboard Helix call chooses between the engine and Twitch.
// A registered engine makes the call itself (woofx3
// docs/services/twitch-channel.md) and answers with Twitch's own status and
// body. Every answer is handed back as a `Response`, so the callers' status
// checks, parsers and error sentences read an engine answer exactly as they
// read Twitch's.

/** The engine's own Twitch timeout is 10s; past this the engine itself is not answering. */
const ENGINE_CALL_TIMEOUT_MS = 15_000;

export interface TwitchHelixRoute {
  /** The engine to ask, or null to call Helix directly. */
  engine: (() => EngineApi) | null;
  /** For fallback logs. */
  instanceId: string;
}

export function directHelixRoute(instanceId: string): TwitchHelixRoute {
  return { engine: null, instanceId };
}

/**
 * Where an action's Helix calls go: the instance's engine, or Helix directly
 * for an instance not registered with its engine.
 */
export async function twitchHelixRoute(ctx: ActionCtx, instanceId: Id<"instances">): Promise<TwitchHelixRoute> {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance?.clientId || !instance.clientSecret) {
    return directHelixRoute(instanceId);
  }
  const engine = { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
  return {
    engine: () => createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret),
    instanceId,
  };
}

export interface HelixRequest {
  /** Names the call in fallback logs. */
  operation: string;
  /**
   * A write goes to Helix directly only when the engine certainly sent
   * nothing to Twitch. After a timeout or a failure Twitch may already have
   * applied it, so it fails the way a Twitch outage fails instead of being
   * sent twice.
   */
  kind: "read" | "write";
  viaEngine: (engine: EngineApi) => Promise<TwitchHelixResult>;
  direct: () => Promise<Response>;
}

/**
 * One Helix call, through the engine when the route has one. When the engine
 * has no answer from Twitch, or cannot be reached, the call goes to Helix
 * directly, except a write that may already have reached Twitch.
 */
export async function helixResponse(route: TwitchHelixRoute, request: HelixRequest): Promise<Response> {
  if (!route.engine) {
    return request.direct();
  }
  let result: TwitchHelixResult;
  try {
    result = await withEngineTimeout(request.viaEngine(route.engine()), ENGINE_CALL_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof EngineTimeoutError) {
      return unconfirmed(route, request, "timeout", error.message);
    }
    // The engine's methods answer every refusal as a result, so a throw is
    // the RPC itself failing: the engine never ran the call.
    return fallBack(route, request, "unreachable", errorText(error));
  }
  const answer = readHelixResult(result);
  switch (answer.kind) {
    case "answer":
      return answer.response;
    case "unconfirmed":
      return unconfirmed(route, request, answer.reason, answer.error);
    case "refused":
      if (answer.code === "invalid_arguments") {
        // This dashboard sent arguments its engine contract refuses: a bug here, not an engine state.
        logger.error("twitch helix: engine refused the arguments, calling Helix directly", {
          instanceId: route.instanceId,
          operation: request.operation,
          error: answer.error,
        });
        return request.direct();
      }
      return fallBack(route, request, answer.code, answer.error);
  }
}

function unconfirmed(
  route: TwitchHelixRoute,
  request: HelixRequest,
  reason: UnconfirmedReason,
  error: string
): Promise<Response> | Response {
  if (request.kind === "read") {
    return fallBack(route, request, reason, error);
  }
  logger.warn("twitch helix: engine could not confirm a write; not resending it", {
    instanceId: route.instanceId,
    operation: request.operation,
    reason,
    error,
  });
  return unconfirmedResponse(reason);
}

function fallBack(route: TwitchHelixRoute, request: HelixRequest, reason: string, error: string): Promise<Response> {
  logger.warn("twitch helix: engine had no answer from Twitch, calling Helix directly", {
    instanceId: route.instanceId,
    operation: request.operation,
    reason,
    error,
  });
  return request.direct();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
