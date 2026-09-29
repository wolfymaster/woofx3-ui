import { twitchScopeHealthKey } from "@convex/lib/twitchScopeHealth";
import { Loader2, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useInstance } from "@/hooks/use-instance";
import { useTwitchConnect } from "@/hooks/use-twitch-connect";
import { useTwitchIntegration } from "@/hooks/use-twitch-integration";
import {
  dismissReconnect,
  isReconnectDismissed,
  reconnectReturnPath,
  sessionStorageOrNull,
  twitchReconnectMessage,
} from "@/lib/twitch-scope-banner";

/**
 * A strip under the shell header when the instance's Twitch link lacks scopes
 * the app requests, or Twitch has refused its token. Without it the gap shows
 * only as a failed action. Dismissal lasts the browser session and only for
 * the gap that was dismissed.
 *
 * Reads the same `getPlatformLinks` subscription the dashboard widgets do, so
 * it adds no query of its own on those pages.
 */
export function TwitchReconnectBanner() {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const { health, twitchLink } = useTwitchIntegration(instanceId);
  const [location] = useLocation();
  const search = useSearch();
  const { connect, starting, error: connectError } = useTwitchConnect();
  // Instance and gap together, so switching instances never carries a
  // dismissal across to one whose gap happens to match.
  const [dismissed, setDismissed] = useState<string | null>(null);

  const message = twitchReconnectMessage(health);
  if (!instanceId || !twitchLink || message === null) {
    return null;
  }
  const key = twitchScopeHealthKey(health);
  const dismissalId = `${instanceId}\n${key}`;
  if (dismissed === dismissalId || isReconnectDismissed(sessionStorageOrNull(), instanceId, key)) {
    return null;
  }

  const dismiss = () => {
    dismissReconnect(sessionStorageOrNull(), instanceId, key);
    setDismissed(dismissalId);
  };

  return (
    <div
      className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm shrink-0"
      data-testid="banner-twitch-reconnect"
    >
      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
      <p className="min-w-0 flex-1">
        {message}
        {connectError && <span className="block text-destructive">{connectError}</span>}
      </p>
      {twitchLink.viewerCanRelink ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0"
          onClick={() => void connect(instanceId, reconnectReturnPath(location, search))}
          disabled={starting}
          data-testid="button-banner-reconnect-twitch"
        >
          {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Reconnect as @{twitchLink.platformUsername}
        </Button>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">Ask an instance admin to reconnect Twitch.</span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={dismiss}
            data-testid="button-banner-dismiss-twitch"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Hide until the next session</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Hide until the next session</TooltipContent>
      </Tooltip>
    </div>
  );
}
