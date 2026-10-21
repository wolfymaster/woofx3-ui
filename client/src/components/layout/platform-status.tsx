import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useInstance } from "@/hooks/use-instance";
import { useTwitchIntegration } from "@/hooks/use-twitch-integration";
import { type PlatformConnection, type PlatformConnectionState, twitchConnection } from "@/lib/platform-status";
import { cn } from "@/lib/utils";

/**
 * A streaming platform the status bar reports on. Both members are hooks, so
 * an implementation can subscribe to whatever it reads; each returns undefined
 * while that is still loading, and the indicator stays hidden until both are
 * known. `useConnection` is only called for a platform that is enabled.
 */
export interface StatusBarPlatform {
  id: string;
  label: string;
  useIsEnabled(instanceId: Id<"instances">): boolean | undefined;
  useConnection(instanceId: Id<"instances">): PlatformConnection | undefined;
}

const twitch: StatusBarPlatform = {
  id: "twitch",
  label: "Twitch",
  // Setup's own answer to whether this instance runs on Twitch. The shell's
  // setup banner and onboarding guard hold the same subscription.
  useIsEnabled(instanceId) {
    return useQuery(api.setup.status, { instanceId })?.twitchRequired;
  },
  useConnection() {
    const { health, twitchLink, isLoading } = useTwitchIntegration();
    return isLoading ? undefined : twitchConnection(health, twitchLink?.platformUsername);
  },
};

/** In status bar order. */
const STATUS_BAR_PLATFORMS: readonly StatusBarPlatform[] = [twitch];

const CONNECTION_STYLE: Record<PlatformConnectionState, { dot: string; text: string }> = {
  connected: { dot: "bg-green-500", text: "text-green-600 dark:text-green-400" },
  degraded: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  disconnected: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

/** One indicator per enabled platform, each led by a separator from what precedes it. */
export function PlatformStatusIndicators() {
  const { instance } = useInstance();
  if (!instance) {
    return null;
  }
  return STATUS_BAR_PLATFORMS.map((platform) => (
    <PlatformIndicator key={platform.id} platform={platform} instanceId={instance._id} />
  ));
}

interface PlatformIndicatorProps {
  platform: StatusBarPlatform;
  instanceId: Id<"instances">;
}

function PlatformIndicator({ platform, instanceId }: PlatformIndicatorProps) {
  const enabled = platform.useIsEnabled(instanceId);
  if (!enabled) {
    return null;
  }
  return <EnabledPlatformIndicator platform={platform} instanceId={instanceId} />;
}

function EnabledPlatformIndicator({ platform, instanceId }: PlatformIndicatorProps) {
  const connection = platform.useConnection(instanceId);
  if (!connection) {
    return null;
  }
  const style = CONNECTION_STYLE[connection.state];
  return (
    <>
      <span className="text-muted-foreground/60" aria-hidden>
        |
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="flex items-center gap-1.5 shrink-0"
            data-testid={`status-platform-${platform.id}`}
            data-state={connection.state}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
            <span className={cn("font-semibold uppercase tracking-wider", style.text)}>{platform.label}</span>
            <span className="sr-only">{connection.detail}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{connection.detail}</TooltipContent>
      </Tooltip>
    </>
  );
}
