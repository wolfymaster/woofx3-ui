import {
  type FailureCode,
  PLATFORM_DISPLAY_NAMES,
  type PlatformId,
  type PlatformOutcome,
  parseGatewayReply,
  type SendToPlatformsParams,
  type UnavailableReason,
} from "@woofx3/api/platform-gateway";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { logger } from "../logger";
import { type EngineCapability, type EngineCapabilityReport, hasEngineCapability } from "./engineCapabilities";
import type { EngineApi } from "./engineInstanceUrl";
import { EngineTimeoutError, withEngineTimeout } from "./inboundWebhookRelay";
import {
  chooseTwitchHelixRoute,
  directHelixRoute,
  type TwitchHelixRoute,
  type TwitchHelixRouteGate,
  twitchHelixRouteGate,
} from "./twitchEngineHelix";

// Dashboard chat writes (chat lines, announcements, pins) through the engine's
// platform gateway, for engines that advertise platform.gateway. The gateway
// sends through the engine's own Twitch connection, so the lines get its
// command guard and are recognised as the engine's own when Twitch echoes
// them, and every answer says what each platform did.
//
// Each write carries an idempotency key built from the user's intent: a
// repeat of the same key while the engine still remembers it replays the
// first answer instead of posting again. See woofx3
// docs/services/platform-gateway.md, "Sending from the dashboard".

/**
 * How long Convex waits for `sendToPlatforms`. The engine waits 12s for its
 * gateway by default (WOOFX3_PLATFORM_GATEWAY_TIMEOUT_MS, never lower) and
 * then answers `timeout` itself; 15s leaves room for that answer to travel
 * back. An engine configured to wait longer makes Convex give up first, which
 * is reported as unconfirmed.
 */
export const GATEWAY_CALL_TIMEOUT_MS = 15_000;

/** What one write did on the platform it was sent to. */
export type GatewaySendOutcome =
  | { kind: "delivered"; messageId: string | null }
  /** The platform took the request and declined to post it (AutoMod, a duplicate, a banned term). */
  | { kind: "dropped"; reason: string }
  /** It may have posted. Never resent: a retry would put the line in chat twice. */
  | { kind: "unconfirmed"; detail: string }
  /** Nothing was sent: the engine, its gateway or the platform connection is not running. */
  | { kind: "unavailable"; detail: string }
  /**
   * The platform or the gateway refused it; `code` classifies the refusal
   * when one was given. `messageId` is a line posted before a later step (a
   * pin) failed.
   */
  | { kind: "failed"; code: FailureCode | null; detail: string; messageId: string | null };

/** Where a dashboard chat write goes: the engine's platform gateway, or the Twitch-only Helix route. */
export type ChatRoute =
  | { kind: "gateway"; instanceId: string; engine: () => EngineApi }
  | { kind: "helix"; helix: TwitchHelixRoute };

/**
 * The gateway when the engine advertises platform.gateway, otherwise the
 * Helix route for `helixCapability`. The engine is asked for its capabilities
 * once, for both choices.
 */
export async function chooseChatRoute(gate: TwitchHelixRouteGate): Promise<ChatRoute> {
  let report: EngineCapabilityReport;
  try {
    report = await gate.capabilities();
  } catch (error) {
    logger.warn("chat route: engine capabilities unreadable, calling Helix directly", {
      instanceId: gate.instanceId,
      error: errorText(error),
    });
    return { kind: "helix", helix: directHelixRoute(gate.instanceId) };
  }
  if (hasEngineCapability(report, "platform.gateway")) {
    return { kind: "gateway", instanceId: gate.instanceId, engine: gate.session };
  }
  // TODO(capability retirement): the Helix route stays for engines that
  // predate platform.gateway; delete it with the legacy twitch* chat RPCs once
  // no supported engine lacks the capability.
  return { kind: "helix", helix: await chooseTwitchHelixRoute({ ...gate, capabilities: async () => report }) };
}

/** Where an action's chat writes go. An instance not registered with an engine calls Helix. */
export async function chatRoute(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  helixCapability: EngineCapability
): Promise<ChatRoute> {
  const gate = await twitchHelixRouteGate(ctx, instanceId, helixCapability);
  return gate ? chooseChatRoute(gate) : { kind: "helix", helix: directHelixRoute(instanceId) };
}

/**
 * Sends one write to one platform through the gateway. Every way of not
 * getting the platform's outcome is returned as an outcome of its own; it
 * throws only on a caller error (anything but exactly one platform).
 */
export async function sendThroughGateway(
  route: Extract<ChatRoute, { kind: "gateway" }>,
  params: SendToPlatformsParams
): Promise<GatewaySendOutcome> {
  const [platform, ...others] = params.platforms;
  if (platform === undefined || others.length > 0) {
    throw new Error(`sendThroughGateway sends to exactly one platform, got ${JSON.stringify(params.platforms)}`);
  }
  let engine: EngineApi;
  try {
    engine = route.engine();
  } catch (error) {
    return logged(route, params, {
      kind: "unavailable",
      detail: `the engine could not be reached: ${errorText(error)}`,
    });
  }
  let raw: unknown;
  try {
    raw = await withEngineTimeout(engine.sendToPlatforms(params), GATEWAY_CALL_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof EngineTimeoutError) {
      return logged(route, params, { kind: "unconfirmed", detail: "the engine did not answer in time" });
    }
    // sendToPlatforms answers every refusal as a result, so a throw is the
    // RPC session failing. It may have failed after the engine received the
    // request and posted the line, so nothing here can say it wasn't sent.
    return logged(route, params, {
      kind: "unconfirmed",
      detail: `the engine connection failed: ${errorText(error)}`,
    });
  }
  return logged(route, params, readGatewayResult(raw, platform));
}

function logged(
  route: Extract<ChatRoute, { kind: "gateway" }>,
  params: SendToPlatformsParams,
  outcome: GatewaySendOutcome
): GatewaySendOutcome {
  if (outcome.kind !== "delivered") {
    logger.warn("platform gateway: write not delivered", {
      instanceId: route.instanceId,
      action: params.action,
      idempotencyKey: params.idempotencyKey,
      outcome: outcome.kind,
      ...(outcome.kind === "dropped" ? { reason: outcome.reason } : { detail: outcome.detail }),
    });
  }
  return outcome;
}

/**
 * `sendToPlatforms`' answer as one platform's outcome. An answer that breaks
 * the contract is unconfirmed: the engine may have acted before it went wrong.
 */
export function readGatewayResult(raw: unknown, platform: PlatformId): GatewaySendOutcome {
  if (typeof raw !== "object" || raw === null) {
    return { kind: "unconfirmed", detail: `unreadable answer ${JSON.stringify(raw) ?? String(raw)}` };
  }
  const result = raw as { ok?: unknown; code?: unknown; error?: unknown; reply?: unknown };
  if (result.ok === false) {
    return failureOutcome(result.code, typeof result.error === "string" ? result.error : "no reason given");
  }
  if (result.ok !== true) {
    return { kind: "unconfirmed", detail: "unreadable answer" };
  }
  const parsed = parseGatewayReply(result.reply);
  if (!parsed.ok) {
    return { kind: "unconfirmed", detail: `unreadable reply: ${parsed.error.field}: ${parsed.error.problem}` };
  }
  const reply = parsed.value;
  if (reply.error) {
    return { kind: "failed", code: reply.error.code, detail: reply.error.message, messageId: null };
  }
  const outcome = reply.results[platform];
  if (!outcome) {
    return { kind: "failed", code: null, detail: `the gateway reported nothing for ${platform}`, messageId: null };
  }
  return platformOutcome(outcome, platform);
}

/** The engine's own codes for a send it could not hand to the gateway, or whose answer it lost. */
function failureOutcome(code: unknown, error: string): GatewaySendOutcome {
  switch (code) {
    case "unavailable":
      return { kind: "unavailable", detail: error };
    case "invalid":
      return { kind: "failed", code: "invalid", detail: error, messageId: null };
    case "timeout":
    case "failed":
      return { kind: "unconfirmed", detail: error };
    default:
      return { kind: "unconfirmed", detail: `unknown failure ${JSON.stringify(code)}: ${error}` };
  }
}

function platformOutcome(outcome: PlatformOutcome, platform: PlatformId): GatewaySendOutcome {
  switch (outcome.status) {
    case "delivered":
      return { kind: "delivered", messageId: outcome.messageId ?? null };
    case "dropped":
      return { kind: "dropped", reason: outcome.reason };
    case "unconfirmed":
      return { kind: "unconfirmed", detail: outcome.message };
    case "unavailable":
      return { kind: "unavailable", detail: UNAVAILABLE_SENTENCES[outcome.reason](PLATFORM_DISPLAY_NAMES[platform]) };
    case "unsupported":
      return {
        kind: "failed",
        code: null,
        detail: `${PLATFORM_DISPLAY_NAMES[platform]} can't do that`,
        messageId: null,
      };
    case "failed":
      return { kind: "failed", code: outcome.code, detail: outcome.message, messageId: outcome.messageId ?? null };
  }
}

const UNAVAILABLE_SENTENCES: Readonly<Record<UnavailableReason, (platform: string) => string>> = {
  not_linked: (platform) => `${platform} isn't connected to the engine`,
  disabled: (platform) => `${platform} is turned off in the engine`,
  stopped: (platform) => `the engine's ${platform} connection is stopped`,
  starting: (platform) => `the engine's ${platform} connection is still starting`,
  parked: (platform) => `the engine paused its ${platform} connection after repeated failures`,
};

/**
 * The sentence a person sees for a write that was not delivered. `what` names
 * the write ("chat message", "announcement").
 */
export function undeliveredError(
  outcome: Exclude<GatewaySendOutcome, { kind: "delivered" }>,
  what: string
): ConvexError<string> {
  switch (outcome.kind) {
    case "dropped":
      return new ConvexError(`Twitch didn't post the ${what}: ${outcome.reason}`);
    case "unconfirmed":
      return new ConvexError(
        `Twitch didn't confirm the ${what} (${outcome.detail}), so it may already be in chat. Sending it again in the next few minutes won't post a second copy.`
      );
    case "unavailable":
      return new ConvexError(`The ${what} wasn't sent: ${outcome.detail}`);
    case "failed":
      return new ConvexError(`Twitch refused the ${what}: ${outcome.detail}`);
  }
}

/** Where an idempotency key comes from: a dashboard action, or the Go live checklist. */
export type IdempotencyScope = "dashboard" | "golive";

/**
 * The shape of a client's operation id. Keys are capped at 200 characters by
 * the gateway; this keeps a scoped key well inside that.
 */
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The gateway idempotency keys for one user intent, one per step:
 * `<scope>:<operationId>:<step>`. A client that sends no operation id (one
 * older than operation ids) gets a fresh id from `newId`, so its writes are
 * not deduped.
 */
export function idempotencyKeys(
  scope: IdempotencyScope,
  operationId: string | undefined,
  newId: () => string
): (step: string) => string {
  if (operationId !== undefined && !OPERATION_ID_PATTERN.test(operationId)) {
    throw new ConvexError("That request carried an unreadable operation id; reload the page and try again");
  }
  const id = operationId ?? newId();
  return (step) => `${scope}:${id}:${step}`;
}

/** A server-side operation id, for a client that sent none. */
export function serverOperationId(): string {
  return crypto.randomUUID();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
