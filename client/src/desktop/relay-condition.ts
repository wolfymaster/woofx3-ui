import type { RelayView } from "@/desktop/generated/window";

/** Long enough that a network blip or a credential renewal doesn't flash a warning in the status bar. */
export const RELAY_GRACE_MS = 30_000;

export type RelayCondition = { kind: "healthy" } | { kind: "limited"; detail: string; canReconnect: boolean };

const HEALTHY: RelayCondition = { kind: "healthy" };

/** When the relay started trying to come back, carried across views until it stops trying. */
export function relayDownSince(view: RelayView, previous: number | null, now: number): number | null {
  if (view.kind === "connecting" || view.kind === "retrying") {
    return previous ?? now;
  }
  return null;
}

export function relayCondition(view: RelayView, downSince: number | null, now: number): RelayCondition {
  switch (view.kind) {
    case "notNeeded":
    case "connected":
      return HEALTHY;
    case "connecting":
    case "retrying":
      if (downSince !== null && now - downSince >= RELAY_GRACE_MS) {
        return {
          kind: "limited",
          detail: "Can't connect, so woofx3 can't reach apps on this computer. Still trying.",
          canReconnect: false,
        };
      }
      return HEALTHY;
    case "displaced":
      return {
        kind: "limited",
        detail: "Another connection took over, so woofx3 can't reach apps on this computer.",
        canReconnect: true,
      };
    case "refused":
      return {
        kind: "limited",
        detail: "woofx3 refused the connection, so it can't reach apps on this computer.",
        canReconnect: true,
      };
    case "unavailable":
      return {
        kind: "limited",
        detail: "Update woofx3 to connect apps on this computer.",
        canReconnect: false,
      };
  }
}
