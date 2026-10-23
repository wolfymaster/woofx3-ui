import { api } from "@convex/_generated/api";
import { isEngineUnreachableData } from "@convex/lib/twitchLinkEngine";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useCallback, useMemo, useState } from "react";
import { EngineUnreachableError } from "@/engine/errors";
import type { TwitchLinkGateway } from "@/engine/gateway";
import type {
  TwitchLink,
  TwitchLinkFlow,
  TwitchLinking,
  TwitchLinkStart,
  TwitchUnlinkOptions,
  TwitchUnlinkResult,
} from "@/engine/types";
import { withPlainError } from "./errors";
import { useInstanceAction, useScopeInstanceId } from "./scope";

// Convex holds the link: Twitch's OAuth redirect lands on Convex, which keeps
// the tokens and hands the engine an access token whenever it asks. Linking
// therefore leaves the page for Twitch; unlinking also tells the engine to
// drop the token it holds, and is refused while it cannot be told.

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

/** What happens to an OAuth-redirect linking attempt. */
export type RedirectLinkingEvent =
  | { type: "start" }
  | { type: "authorizeUrlReady" }
  | { type: "refused"; error: unknown }
  | { type: "cancel" };

/**
 * The next state of a linking attempt under the redirect flow. A start while
 * one is under way changes nothing, and `redirecting` lasts until the page
 * leaves for Twitch. Nothing is pending on Convex's side before the
 * redirect, so a cancel only returns to idle: the OAuth state it minted
 * expires unused.
 */
export function nextRedirectLinking(current: TwitchLinking, event: RedirectLinkingEvent): TwitchLinking {
  switch (event.type) {
    case "start": {
      return current.status === "starting" || current.status === "redirecting" ? current : { status: "starting" };
    }
    case "authorizeUrlReady": {
      return { status: "redirecting" };
    }
    case "refused": {
      return { status: "failed", error: event.error instanceof Error ? event.error.message : String(event.error) };
    }
    case "cancel": {
      return IDLE;
    }
  }
}

function isUnderWay(linking: TwitchLinking): boolean {
  return linking.status === "starting" || linking.status === "redirecting";
}

function useLinkFlow(): TwitchLinkFlow {
  const startConnect = useInstanceAction(api.twitchIntegration.startConnect);
  const [linking, setLinking] = useState<TwitchLinking>(IDLE);
  const apply = useCallback((event: RedirectLinkingEvent) => {
    setLinking((current) => nextRedirectLinking(current, event));
  }, []);

  const start = useCallback(
    ({ returnTo }: TwitchLinkStart) => {
      if (isUnderWay(linking)) {
        return;
      }
      apply({ type: "start" });
      startConnect({ redirectTo: returnTo })
        .then(({ authorizeUrl }) => {
          apply({ type: "authorizeUrlReady" });
          window.location.assign(authorizeUrl);
        })
        .catch((error: unknown) => {
          apply({ type: "refused", error });
        });
    },
    [linking, startConnect, apply]
  );

  const cancel = useCallback(() => apply({ type: "cancel" }), [apply]);

  return { linking, start, cancel };
}

/** Rethrows an engine-unreachable refusal as its typed error, and any other refusal as a plain Error. */
function rethrowTwitchLinkError(error: unknown): never {
  if (error instanceof ConvexError && isEngineUnreachableData(error.data)) {
    throw new EngineUnreachableError(error.data.message);
  }
  return withPlainError(error);
}

function useUnlinkRequest() {
  const disconnect = useInstanceAction(api.twitchIntegration.disconnect);
  return useCallback(
    async (options?: TwitchUnlinkOptions): Promise<TwitchUnlinkResult> => {
      try {
        const result = await disconnect({ platform: TWITCH, force: options?.force });
        return { warning: result.warning };
      } catch (error) {
        return rethrowTwitchLinkError(error);
      }
    },
    [disconnect]
  );
}

function useRetryEngineSyncRequest() {
  const retry = useInstanceAction(api.twitchIntegration.retryEngineSync);
  return useCallback(async () => {
    try {
      await retry({});
    } catch (error) {
      rethrowTwitchLinkError(error);
    }
  }, [retry]);
}

export const convexTwitchLinkGateway: TwitchLinkGateway = {
  useLink,
  useLinkFlow,
  useUnlinkRequest,
  useRetryEngineSyncRequest,
};
