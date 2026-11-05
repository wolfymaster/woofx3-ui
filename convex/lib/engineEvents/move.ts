import { ENGINE_CAPABILITIES } from "@woofx3/api/capabilities";
import { ENGINE_EVENT_BATCH_PATH } from "../../engineEventsHttp";
import { sha256Hex } from "../oauthHandoff";

/** Where engines post their events: maintenance's `POST /v1/engine-events`, as one full URL. */
export const ENGINE_EVENTS_INGEST_URL_ENV = "ENGINE_EVENTS_INGEST_URL";

export type MoveOutcome = "moved" | "unsupported";

/**
 * The side effects of moving one engine onto the event queue, at the network
 * and storage boundary, so the order they happen in can be checked.
 */
export interface EventQueueMovePorts {
  engineCapabilities(): Promise<readonly string[]>;
  putSource(source: { deliveryUrl: string; tokenSha256: string }): Promise<void>;
  recordTokenHash(tokenSha256: string): Promise<void>;
  setEventsTarget(target: { url: string; token: string }): Promise<void>;
  recordTargetSet(): Promise<void>;
}

export interface EventQueueUrls {
  /** This deployment's batch endpoint, which the queue delivers to. */
  deliveryUrl: string;
  /** The queue's ingest endpoint, which the engine posts to. */
  eventsUrl: string;
}

/** The URLs a move needs, from the deployment's environment; throws when one is missing. */
export function eventQueueUrlsFromEnv(): EventQueueUrls {
  const siteUrl = process.env.CONVEX_SITE_URL;
  const eventsUrl = process.env[ENGINE_EVENTS_INGEST_URL_ENV];
  if (!siteUrl) {
    throw new Error("CONVEX_SITE_URL is not configured");
  }
  if (!eventsUrl) {
    throw new Error(`${ENGINE_EVENTS_INGEST_URL_ENV} is not configured, so engines cannot be moved to the event queue`);
  }
  return { deliveryUrl: `${siteUrl.replace(/\/+$/, "")}${ENGINE_EVENT_BATCH_PATH}`, eventsUrl };
}

/**
 * Moves one engine's events from the webhook route to the queue. Each step
 * comes before the one that depends on it, so a failure anywhere leaves the
 * engine on the webhook route, losing nothing, and running the move again
 * converges:
 *
 * 1. The queue learns the token's hash before the engine has the token, so
 *    the engine's first queued event is accepted.
 * 2. The instance records the hash before the engine switches, so the first
 *    batch is not rejected as stale.
 * 3. The engine switches; from then on it posts each event to the queue only.
 * 4. The instance records that it moved, which is what skips a later move.
 */
export async function moveEngineToEventQueue(
  ports: EventQueueMovePorts,
  urls: EventQueueUrls,
  token: string
): Promise<MoveOutcome> {
  const capabilities = await ports.engineCapabilities();
  if (!capabilities.includes(ENGINE_CAPABILITIES.callbacksEventsTarget)) {
    return "unsupported";
  }
  const tokenSha256 = await sha256Hex(token);
  await ports.putSource({ deliveryUrl: urls.deliveryUrl, tokenSha256 });
  await ports.recordTokenHash(tokenSha256);
  await ports.setEventsTarget({ url: urls.eventsUrl, token });
  await ports.recordTargetSet();
  return "moved";
}
