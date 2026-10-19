import type { TwitchHelixResult } from "@woofx3/api";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { logger } from "../logger";
import {
  type EngineCapability,
  type EngineCapabilityReport,
  fetchEngineCapabilities,
  hasEngineCapability,
} from "./engineCapabilities";
import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";
import { EngineTimeoutError, withEngineTimeout } from "./inboundWebhookRelay";

// The one place a dashboard Helix call chooses between the engine and Twitch.
// Engines that advertise a `twitch.*` capability make the call themselves
// (woofx3 docs/services/twitch-channel.md) and answer with Twitch's own status
// and body. Every answer is handed back as a `Response`, so the callers' status
// checks, parsers and error sentences read an engine answer exactly as they
// read Twitch's.

/** The engine's own Twitch timeout is 10s; past this the engine itself is not answering. */
const ENGINE_CALL_TIMEOUT_MS = 15_000;
/** A Helix call must not wait long on an engine that may not be running; Helix is the fallback. */
const CAPABILITY_TIMEOUT_MS = 3_000;

export interface TwitchHelixRoute {
  /** The engine to ask, or null to call Helix directly. */
  engine: (() => EngineApi) | null;
  /** For fallback logs. */
  instanceId: string;
}

export function directHelixRoute(instanceId: string): TwitchHelixRoute {
  return { engine: null, instanceId };
}

export interface TwitchHelixRouteGate {
  instanceId: string;
  capability: EngineCapability;
  capabilities: () => Promise<EngineCapabilityReport>;
  session: () => EngineApi;
}

/**
 * The engine when it advertises `capability`, otherwise Helix. An engine that
 * cannot say what it supports gets Helix: it is likely not running, and Helix
 * works without it.
 */
export async function chooseTwitchHelixRoute(gate: TwitchHelixRouteGate): Promise<TwitchHelixRoute> {
  let report: EngineCapabilityReport;
  try {
    report = await gate.capabilities();
  } catch (error) {
    logger.warn("twitch helix: engine capabilities unreadable, calling Helix directly", {
      instanceId: gate.instanceId,
      capability: gate.capability,
      error: errorText(error),
    });
    return directHelixRoute(gate.instanceId);
  }
  if (!hasEngineCapability(report, gate.capability)) {
    return directHelixRoute(gate.instanceId);
  }
  return { engine: gate.session, instanceId: gate.instanceId };
}

/**
 * Where an action's Helix calls go. Resolved once per action, so an action
 * making several calls asks the engine for its capabilities once. An
 * instance not registered with its engine calls Helix, as it always has.
 */
export async function twitchHelixRoute(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  capability: EngineCapability
): Promise<TwitchHelixRoute> {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance?.clientId || !instance.clientSecret) {
    return directHelixRoute(instanceId);
  }
  const engine = { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
  return chooseTwitchHelixRoute({
    instanceId,
    capability,
    capabilities: () => withEngineTimeout(fetchEngineCapabilities(engine), CAPABILITY_TIMEOUT_MS),
    session: () => createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret),
  });
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
 * The status a write reports when Twitch may or may not have applied it.
 * Every caller already turns a Twitch 5xx into its failure sentence.
 */
export const UNCONFIRMED_WRITE_STATUS = { failed: 502, timeout: 504 } as const;

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
  if (!isHelixResult(result)) {
    return unconfirmed(route, request, "failed", `unreadable answer ${JSON.stringify(result) ?? String(result)}`);
  }
  if (result.ok) {
    return okResponse(result.body);
  }
  switch (result.code) {
    case "helix":
      return new Response(result.body === "" ? null : result.body, { status: result.status });
    case "timeout":
    case "failed":
      return unconfirmed(route, request, result.code, result.error);
    case "invalid_arguments":
      // This dashboard sent arguments its engine contract refuses: a bug here, not an engine state.
      logger.error("twitch helix: engine refused the arguments, calling Helix directly", {
        instanceId: route.instanceId,
        operation: request.operation,
        error: result.error,
      });
      return request.direct();
    case "not_linked":
    case "unavailable":
      return fallBack(route, request, result.code, result.error);
  }
}

function okResponse(body: unknown): Response {
  if (body === null || body === undefined) {
    return new Response(null, { status: 204 });
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function unconfirmed(
  route: TwitchHelixRoute,
  request: HelixRequest,
  reason: "timeout" | "failed",
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
  return new Response(null, { status: UNCONFIRMED_WRITE_STATUS[reason] });
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

function isHelixResult(value: unknown): value is TwitchHelixResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as { ok?: unknown; code?: unknown; status?: unknown; body?: unknown };
  if (result.ok === true) {
    return true;
  }
  if (result.ok !== false || typeof result.code !== "string") {
    return false;
  }
  if (result.code !== "helix") {
    return true;
  }
  // A Response refuses a status outside 200-599, and an error result below 400 would be a 2xx read as a failure.
  return (
    typeof result.status === "number" &&
    Number.isInteger(result.status) &&
    result.status >= 400 &&
    result.status <= 599 &&
    typeof result.body === "string"
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
