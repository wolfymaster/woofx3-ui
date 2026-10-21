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
 * Whether the engine has picked up a freshly saved link. An instance without a
 * registered engine has nothing to pick it up, so it is connected.
 */
export async function syncAfterConnect(
  hasEngine: boolean,
  sync: () => Promise<void>,
  onFailure: (err: unknown) => void
): Promise<EngineSyncStatus> {
  if (!hasEngine) {
    return "connected";
  }
  try {
    await sync();
  } catch (err) {
    onFailure(err);
    return "connectedPendingEngine";
  }
  return "connected";
}
