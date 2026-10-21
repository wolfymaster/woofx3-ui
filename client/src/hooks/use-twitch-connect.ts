import { useCallback } from "react";
import { useTwitchLinkFlow } from "@/engine/hooks/use-twitch-link";

/**
 * Starts linking Twitch for the instance, coming back to `returnTo` when the
 * gateway sends the browser to Twitch to approve. Only an owner or admin may
 * link, so a refusal surfaces here as `error` before anything else happens.
 *
 * `starting` covers the whole attempt, including waiting for the streamer to
 * approve a code elsewhere; `linking` is the attempt itself, for a caller
 * that shows that code.
 */
export function useTwitchConnect() {
  const { linking, start, cancel } = useTwitchLinkFlow();

  const connect = useCallback((returnTo: string) => start({ returnTo }), [start]);
  const starting =
    linking.status === "starting" || linking.status === "redirecting" || linking.status === "awaitingApproval";
  const error = linking.status === "failed" ? linking.error : null;

  return { connect, cancel, starting, error, linking };
}
