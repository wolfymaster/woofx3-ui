import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export function useTwitchIntegration(instanceId: Id<"instances"> | undefined) {
  const platformLinks = useQuery(
    api.instances.getPlatformLinks,
    instanceId ? { instanceId } : "skip",
  );

  const isLoading = platformLinks === undefined;
  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  const isConnected = !!twitchLink;

  return {
    isConnected,
    twitchLink,
    isLoading,
  };
}
