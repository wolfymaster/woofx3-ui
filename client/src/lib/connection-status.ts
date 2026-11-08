import type { ObsStatus } from "@convex/lib/engineObsStatus";
import { readLocalEndpoints } from "@shared/local-endpoints";
import type { TwitchScopeHealth } from "@shared/twitch-scope-health";
import { describeObsStatus } from "@/lib/obs-status";

/**
 * How one connected app or platform stands, as the shell's status bar shows it.
 * `degraded` works for some things but not everything the app asks of it, or
 * is waiting on something else. `pending` makes no claim either way: still
 * connecting, or nobody could say.
 */
export type ConnectionState = "connected" | "degraded" | "disconnected" | "pending";

export interface Connection {
  /** Stable across renders and unique in the status bar. */
  id: string;
  label: string;
  state: ConnectionState;
  /** One line on what the state means for this app. */
  detail: string;
}

/** Most urgent first, which decides both the status bar's order and the overflow chip's colour. */
const STATE_URGENCY: Record<ConnectionState, number> = {
  disconnected: 0,
  degraded: 1,
  pending: 2,
  connected: 3,
};

export function needsAttention(state: ConnectionState): boolean {
  return state === "disconnected" || state === "degraded";
}

export function twitchConnection(health: TwitchScopeHealth, username: string | undefined): Connection {
  const base = { id: "twitch", label: "Twitch" };
  switch (health.state) {
    case "unlinked":
      return { ...base, state: "disconnected", detail: "Twitch isn't connected" };
    case "revoked":
      return { ...base, state: "disconnected", detail: "Twitch no longer accepts this engine's connection" };
    case "missing": {
      const labels = health.missing.map((capability) => capability.label);
      return { ...base, state: "degraded", detail: `Missing permission for: ${labels.join(", ")}` };
    }
    case "ok":
      return { ...base, state: "connected", detail: username ? `Connected as @${username}` : "Connected" };
  }
}

/** An installed module, as far as the status bar needs to know it. */
export interface StatusBarModule {
  name: string;
  moduleKey?: string;
  status: string;
  manifest: Record<string, unknown> | null;
}

/** A module the status bar reports: installed, and declaring something on the streamer's network it uses. */
export interface LocalModule {
  /** The manifest id, from the `<manifest id>:<version>` module key. */
  id: string;
  label: string;
}

/** Installed means active, so every one of these is reported, whichever module it is. */
export function localModules(modules: readonly StatusBarModule[]): LocalModule[] {
  return modules.flatMap(({ name, moduleKey, status, manifest }) => {
    if (status !== "installed" || !moduleKey || readLocalEndpoints(manifest).length === 0) {
      return [];
    }
    return [{ id: moduleKey.split(":", 1)[0] as string, label: name }];
  });
}

/** A local module whose status nothing reports. It stays visible without claiming to be up or down. */
export function unreportedConnection(module: LocalModule): Connection {
  return {
    id: module.id,
    label: module.label,
    state: "pending",
    detail: "Installed. This module doesn't report whether it's connected.",
  };
}

/**
 * A connection the engine's OBS status describes. While the relay is down the
 * relay is the one problem to fix, so it reads as waiting rather than as a
 * second failure.
 */
export function obsConnection(module: LocalModule, status: ObsStatus | null, relayLimited: boolean): Connection {
  const base = { id: module.id, label: module.label };
  if (!status) {
    return { ...base, state: "pending", detail: `Checking ${module.label}…` };
  }
  const { text } = describeObsStatus(status);
  if (status.state === "connected") {
    return { ...base, state: "connected", detail: text };
  }
  if (status.state === "retrying") {
    if (relayLimited || status.failure === "relay") {
      return { ...base, state: "degraded", detail: `Waiting on the woofx3 desktop app to reach ${module.label}` };
    }
    return { ...base, state: "disconnected", detail: text };
  }
  return { ...base, state: "pending", detail: text };
}

/** Problems first, so they are the last thing to overflow; otherwise keeps the given order, so names don't shuffle. */
export function sortConnections(connections: readonly Connection[]): Connection[] {
  const attention = connections.filter((connection) => needsAttention(connection.state));
  attention.sort((a, b) => STATE_URGENCY[a.state] - STATE_URGENCY[b.state]);
  return [...attention, ...connections.filter((connection) => !needsAttention(connection.state))];
}

export function worstState(connections: readonly Connection[]): ConnectionState {
  return connections.reduce<ConnectionState>(
    (worst, { state }) => (STATE_URGENCY[state] < STATE_URGENCY[worst] ? state : worst),
    "connected"
  );
}

export interface ConnectionFit {
  /** Width of each name, in display order. */
  widths: readonly number[];
  chipWidth: number;
  gap: number;
  available: number;
}

/** How many names fit, leaving room for the overflow chip whenever any name won't. */
export function fitConnections({ widths, chipWidth, gap, available }: ConnectionFit): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available) {
    return widths.length;
  }
  let used = chipWidth;
  let count = 0;
  for (const width of widths) {
    used += width + gap;
    if (used > available) {
      break;
    }
    count += 1;
  }
  return count;
}
