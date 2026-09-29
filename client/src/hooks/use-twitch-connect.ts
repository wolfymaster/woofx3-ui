import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useState } from "react";

/**
 * Starts Twitch's integration OAuth flow for an instance and navigates the
 * browser to Twitch. Convex mints the OAuth state only for an owner or admin,
 * so a refusal surfaces here as `error` before the browser leaves the page.
 */
export function useTwitchConnect() {
  const startConnect = useAction(api.twitchIntegration.startConnect);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (instanceId: Id<"instances">, redirectTo: string) => {
      setStarting(true);
      setError(null);
      try {
        const { authorizeUrl } = await startConnect({ instanceId, redirectTo });
        window.location.assign(authorizeUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStarting(false);
      }
    },
    [startConnect]
  );

  return { connect, starting, error };
}
