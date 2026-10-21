import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useMemo, useState } from "react";
import type { TwitchLinkGateway } from "@/engine/gateway";
import type { TwitchLink, TwitchLinkFlow, TwitchLinking, TwitchLinkStart } from "@/engine/types";
import { useInstanceAction, useScopeInstanceId } from "./scope";

// Convex holds the link: Twitch's OAuth redirect lands on Convex, which keeps
// the tokens and hands the engine an access token whenever it asks. Linking
// therefore leaves the page for Twitch; unlinking also tells the engine to
// drop the token it holds.

type PlatformLinkRow = FunctionReturnType<typeof api.instances.getPlatformLinks>[number];

const TWITCH = "twitch";
const IDLE: TwitchLinking = { status: "idle" };

export function toTwitchLink(row: PlatformLinkRow): TwitchLink {
  return {
    platformUserId: row.platformUserId,
    platformUsername: row.platformUsername,
    profileImageUrl: row.profileImageUrl,
    scopes: row.scopes,
    authFailedAt: row.authFailedAt,
    viewerCanRelink: row.viewerCanRelink,
  };
}

/** The instance's Twitch row among its platform links, as the gateway's link; null when it has none. */
export function twitchLinkOf(rows: readonly PlatformLinkRow[]): TwitchLink | null {
  const row = rows.find((link) => link.platform === TWITCH);
  return row ? toTwitchLink(row) : null;
}

function useLink() {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.instances.getPlatformLinks, instanceId ? { instanceId } : "skip");
  return useMemo(() => (rows === undefined ? undefined : twitchLinkOf(rows)), [rows]);
}

function useLinkFlow(): TwitchLinkFlow {
  const startConnect = useInstanceAction(api.twitchIntegration.startConnect);
  const [linking, setLinking] = useState<TwitchLinking>(IDLE);

  const start = useCallback(
    ({ returnTo }: TwitchLinkStart) => {
      setLinking({ status: "starting" });
      startConnect({ redirectTo: returnTo })
        .then(({ authorizeUrl }) => {
          // Stays redirecting: the page is leaving for Twitch, and comes back
          // to `returnTo` with the link made.
          setLinking({ status: "redirecting" });
          window.location.assign(authorizeUrl);
        })
        .catch((err: unknown) => {
          setLinking({ status: "failed", error: err instanceof Error ? err.message : String(err) });
        });
    },
    [startConnect]
  );

  // Nothing is pending on Convex's side before the redirect: the OAuth state
  // it minted simply expires unused.
  const cancel = useCallback(() => setLinking(IDLE), []);

  return { linking, start, cancel };
}

function useUnlinkRequest() {
  const disconnect = useInstanceAction(api.twitchIntegration.disconnect);
  return useCallback(async () => {
    await disconnect({ platform: TWITCH });
  }, [disconnect]);
}

export const convexTwitchLinkGateway: TwitchLinkGateway = {
  useLink,
  useLinkFlow,
  useUnlinkRequest,
};
