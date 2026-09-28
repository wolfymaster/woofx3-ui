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

type ReadableStorage = Pick<Storage, "getItem"> | null;
type WritableStorage = Pick<Storage, "setItem"> | null;

/**
 * The browser's session storage, or null where reading the property itself
 * throws (site data blocked). The banner renders in the shell on every page,
 * so a throw here would take the whole shell down with it.
 */
export function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Whether the creator already dismissed this exact gap this session. Stored
 * per instance against the health key, so a different gap shows again.
 * Storage that is missing or throws reads as not dismissed.
 */
export function isReconnectDismissed(storage: ReadableStorage, instanceId: string, key: string): boolean {
  if (!storage) {
    return false;
  }
  try {
    return storage.getItem(DISMISSED_PREFIX + instanceId) === key;
  } catch {
    return false;
  }
}

export function dismissReconnect(storage: WritableStorage, instanceId: string, key: string): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(DISMISSED_PREFIX + instanceId, key);
  } catch {
    // Dismissal then lasts only as long as the component's own state.
  }
}

/** Where the OAuth flow should bring the creator back to: the current path, query string included. */
export function reconnectReturnPath(path: string, search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return query ? `${path}?${query}` : path;
}
