import type { Id } from "@convex/_generated/dataModel";
import type { MissingTwitchCapability, TwitchScopeHealth } from "@convex/lib/twitchScopeHealth";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTwitchConnect } from "@/hooks/use-twitch-connect";

interface TwitchScopeStatusProps {
  instanceId: Id<"instances">;
  health: TwitchScopeHealth;
  /** The linked account's name, so the creator signs in to Twitch as that account and not another. */
  platformUsername: string;
  /** Only owners and admins may replace the link; see `viewerCanRelink` in convex/instances.ts. */
  canRelink: boolean;
}

/** Which Twitch permissions the linked account granted, with a way to fix a gap. */
export function TwitchScopeStatus({ instanceId, health, platformUsername, canRelink }: TwitchScopeStatusProps) {
  const { connect, starting, error: connectError } = useTwitchConnect();

  if (health.state === "unlinked") {
    return null;
  }

  const reconnect = canRelink ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void connect(instanceId, "/admin/integrations")}
      disabled={starting}
      data-testid="button-status-reconnect-twitch"
    >
      {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Reconnect as @{platformUsername}
    </Button>
  ) : (
    <span className="text-xs text-muted-foreground">Ask an instance admin to reconnect Twitch.</span>
  );

  if (health.state === "ok") {
    if (health.optionalMissing.length === 0) {
      return (
        <div className="flex items-center gap-2 rounded-lg border p-4 text-sm" data-testid="twitch-scope-status">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span>Every permission the app uses is granted.</span>
        </div>
      );
    }
    return (
      <div
        className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4 text-sm"
        data-testid="twitch-scope-status"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
          <div className="min-w-0 space-y-2">
            <p>Every required permission is granted. Reconnect to add these optional ones:</p>
            <OptionalCapabilityBadges capabilities={health.optionalMissing} />
            {connectError && <p className="text-destructive">{connectError}</p>}
          </div>
        </div>
        {reconnect}
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
      data-testid="twitch-scope-status"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 space-y-2">
          {health.state === "revoked" ? (
            <p>Twitch refused this connection's token. Actions that talk to Twitch fail until you reconnect.</p>
          ) : (
            <>
              <p>The linked account has not granted everything the app uses. These fail until you reconnect:</p>
              <div className="flex flex-wrap gap-1.5">
                {health.missing.map((capability) => (
                  <Badge
                    key={capability.label}
                    variant="secondary"
                    title={capability.missingScopes.join("\n")}
                    data-testid={`twitch-missing-${capability.label}`}
                  >
                    {capability.label}
                  </Badge>
                ))}
              </div>
              <OptionalCapabilityBadges capabilities={health.optionalMissing} />
            </>
          )}
          {connectError && <p className="text-destructive">{connectError}</p>}
        </div>
      </div>
      {reconnect}
    </div>
  );
}

function OptionalCapabilityBadges({ capabilities }: { capabilities: MissingTwitchCapability[] }) {
  if (capabilities.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {capabilities.map((capability) => (
        <Badge
          key={capability.label}
          variant="outline"
          title={capability.missingScopes.join("\n")}
          data-testid={`twitch-optional-missing-${capability.label}`}
        >
          {capability.label}: not granted (optional)
        </Badge>
      ))}
    </div>
  );
}
