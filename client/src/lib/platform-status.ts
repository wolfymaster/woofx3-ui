import type { TwitchScopeHealth } from "@convex/lib/twitchScopeHealth";

/**
 * How a streaming platform's link stands, as the shell's status bar shows it.
 * `degraded` is a link that works for some things but not everything the app
 * asks of it, such as a Twitch link missing scopes added after it was made.
 */
export type PlatformConnectionState = "connected" | "degraded" | "disconnected";

export interface PlatformConnection {
  state: PlatformConnectionState;
  /** One line on what the state means for this platform, shown on hover. */
  detail: string;
}

export function twitchConnection(health: TwitchScopeHealth, username: string | undefined): PlatformConnection {
  switch (health.state) {
    case "unlinked":
      return { state: "disconnected", detail: "Twitch isn't connected" };
    case "revoked":
      return { state: "disconnected", detail: "Twitch no longer accepts this instance's connection" };
    case "missing": {
      const labels = health.missing.map((capability) => capability.label);
      return { state: "degraded", detail: `Missing permission for: ${labels.join(", ")}` };
    }
    case "ok":
      return { state: "connected", detail: username ? `Connected as @${username}` : "Connected" };
  }
}
