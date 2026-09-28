import type { TwitchScopeHealth } from "@convex/lib/twitchScopeHealth";

/** What the reconnect prompt says for a link that needs one, or null when it does not. */
export function twitchReconnectMessage(health: TwitchScopeHealth): string | null {
  if (health.state === "revoked") {
    return "Twitch no longer accepts this instance's connection. Reconnect to bring back everything that talks to Twitch.";
  }
  if (health.state === "missing") {
    const labels = health.missing.map((capability) => capability.label);
    return `Twitch has not granted permission for: ${labels.join(", ")}. Reconnect to grant it.`;
  }
  return null;
}

const DISMISSED_PREFIX = "woofx3:twitch-reconnect-dismissed:";

/**
 * Whether the creator already dismissed this exact gap this session. Stored
 * per instance against the health key, so a different gap shows again.
 * Storage that throws (private mode, disabled) reads as not dismissed.
 */
export function isReconnectDismissed(storage: Pick<Storage, "getItem">, instanceId: string, key: string): boolean {
  try {
    return storage.getItem(DISMISSED_PREFIX + instanceId) === key;
  } catch {
    return false;
  }
}

export function dismissReconnect(storage: Pick<Storage, "setItem">, instanceId: string, key: string): void {
  try {
    storage.setItem(DISMISSED_PREFIX + instanceId, key);
  } catch {
    // Dismissal then lasts only as long as the component's own state.
  }
}
