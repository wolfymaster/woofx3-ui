import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { twitchScopeHealth } from "@convex/lib/twitchScopeHealth";
import { useQuery } from "convex/react";
import { useMemo } from "react";

export function useTwitchIntegration(instanceId: Id<"instances"> | undefined) {
  const platformLinks = useQuery(api.instances.getPlatformLinks, instanceId ? { instanceId } : "skip");

  const isLoading = platformLinks === undefined;
  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  const isConnected = !!twitchLink;
  // Reads "unlinked" while loading; callers that act on the health only act on
  // "missing" or "revoked", so nothing flashes before the links arrive.
  const health = useMemo(() => twitchScopeHealth(twitchLink), [twitchLink]);

  return {
    isConnected,
    twitchLink,
    isLoading,
    health,
  };
}
