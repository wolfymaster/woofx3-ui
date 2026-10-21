import { useCallback } from "react";
import { useTwitchLinkFlow } from "@/engine/hooks/use-twitch-link";

/**
 * Starts linking Twitch for the instance, coming back to `returnTo` when the
 * gateway sends the browser to Twitch to approve. Only an owner or admin may
 * link, so a refusal surfaces here as `error` before anything else happens.
 */
export function useTwitchConnect() {
  const { linking, start } = useTwitchLinkFlow();

  const connect = useCallback((returnTo: string) => start({ returnTo }), [start]);
  const starting = linking.status === "starting" || linking.status === "redirecting";
  const error = linking.status === "failed" ? linking.error : null;

  return { connect, starting, error };
}
