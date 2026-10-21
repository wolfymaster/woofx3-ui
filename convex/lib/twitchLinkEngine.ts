/**
 * How connecting and disconnecting Twitch treat an engine that cannot be
 * reached. Pure over injected effects, so the rules are testable without a
 * Convex runtime.
 */

import { ConvexError } from "convex/values";

export const ENGINE_UNREACHABLE = "engine_unreachable";

export const ENGINE_UNREACHABLE_MESSAGE =
  "Your engine could not be reached, so Twitch was not changed there. Check that it is online and try again.";

export const DISCONNECT_FORCED_WARNING =
  "Your engine could not be reached, so it may still be using this Twitch connection until it is back online.";

/** What a ConvexError carries when the engine could not be reached. */
export type EngineUnreachableData = {
  code: typeof ENGINE_UNREACHABLE;
  message: string;
};

export function engineUnreachable(message: string = ENGINE_UNREACHABLE_MESSAGE): ConvexError<EngineUnreachableData> {
  return new ConvexError<EngineUnreachableData>({ code: ENGINE_UNREACHABLE, message });
}

export function isEngineUnreachableData(data: unknown): data is EngineUnreachableData {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const candidate = data as Partial<EngineUnreachableData>;
  return candidate.code === ENGINE_UNREACHABLE && typeof candidate.message === "string";
}

export type DisconnectResult = { ok: true; warning?: string };

export interface DisconnectEffects {
  /** Tells the engine to drop its Twitch token; null when the instance has no registered engine. */
  deleteTokenOnEngine: (() => Promise<void>) | null;
  deleteLink: () => Promise<void>;
  /** Called with the engine's failure when it is overridden by `force`. */
  onEngineFailure: (err: unknown) => void;
}

/**
 * Removes the link only once the engine has dropped its token, so a failed
 * engine call never leaves the engine acting on a connection the page says is
 * gone. `force` accepts that outcome and says so in the result.
 */
export async function disconnectLink(effects: DisconnectEffects, force: boolean): Promise<DisconnectResult> {
  if (!effects.deleteTokenOnEngine) {
    await effects.deleteLink();
    return { ok: true };
  }
  try {
    await effects.deleteTokenOnEngine();
  } catch (err) {
    effects.onEngineFailure(err);
    if (!force) {
      throw engineUnreachable();
    }
    await effects.deleteLink();
    return { ok: true, warning: DISCONNECT_FORCED_WARNING };
  }
  await effects.deleteLink();
  return { ok: true };
}

export type EngineSyncStatus = "connected" | "connectedPendingEngine";

/**
 * What an engine sync did when it did not fault. `no_engine`: the instance has
 * no registered engine to tell. `engine_failed`: the engine call itself failed
 * or ran out of time. Missing links, missing instances and server
 * configuration faults are not outcomes; the sync throws them.
 */
export type EngineSyncOutcome = "synced" | "no_engine" | "engine_failed";

/** How long one engine call may take before it counts as a failed call. */
export const ENGINE_CALL_DEADLINE_MS = 15_000;

/** Rejects when `call` has not settled within `deadlineMs`, so a hung engine fails like a refused one. */
export async function withEngineDeadline<T>(call: () => Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`engine call exceeded ${deadlineMs}ms`)), deadlineMs);
  });
  try {
    return await Promise.race([call(), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the engine has picked up a freshly saved link. An instance without a
 * registered engine has nothing to pick it up, so it is connected. A fault in
 * the sync itself propagates: a Retry banner could never fix it.
 */
export async function syncAfterConnect(sync: () => Promise<EngineSyncOutcome>): Promise<EngineSyncStatus> {
  const outcome = await sync();
  return outcome === "engine_failed" ? "connectedPendingEngine" : "connected";
}

/**
 * Offers a saved link to the engine again. Only a failed engine call is
 * `engine_unreachable`; a missing link or engine is the caller's mistake and
 * says so.
 */
export async function retryEngineSyncWith(sync: () => Promise<EngineSyncOutcome>): Promise<void> {
  const outcome = await sync();
  if (outcome === "engine_failed") {
    throw engineUnreachable();
  }
  if (outcome === "no_engine") {
    throw new Error("This instance has no engine registered to hand Twitch to");
  }
}
