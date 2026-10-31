import { twitchScopeHealth } from "@shared/twitch-scope-health";
import { useMemo } from "react";
import { useTwitchLink } from "@/engine/hooks/use-twitch-link";

export function useTwitchIntegration() {
  const link = useTwitchLink();

  const isLoading = link === undefined;
  const twitchLink = link ?? undefined;
  const isConnected = !!twitchLink;
  // Reads "unlinked" while loading; callers that act on the health only act on
  // "missing" or "revoked", so nothing flashes before the link arrives.
  const health = useMemo(() => twitchScopeHealth(twitchLink), [twitchLink]);

  return {
    isConnected,
    twitchLink,
    isLoading,
    health,
  };
}
