export type EngineConnection = "connected" | "limited" | "upgrading" | "starting" | "disconnected";

export const ENGINE_CONNECTION: Record<EngineConnection, { label: string; dot: string; text: string }> = {
  connected: { label: "Connected", dot: "bg-green-500", text: "text-green-600 dark:text-green-400" },
  limited: { label: "Limited", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  upgrading: { label: "Upgrading", dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  starting: { label: "Starting", dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  disconnected: { label: "Disconnected", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

/**
 * An engine that is down for an upgrade, or still being built, is not a lost
 * connection, so it is named for what it is. A connected engine is never
 * starting: registration is what ends the build.
 */
export function engineConnection(
  connected: boolean,
  upgrading: boolean,
  relayLimited: boolean,
  starting: boolean
): EngineConnection {
  if (connected) {
    return relayLimited ? "limited" : "connected";
  }
  if (starting) {
    return "starting";
  }
  return upgrading ? "upgrading" : "disconnected";
}
