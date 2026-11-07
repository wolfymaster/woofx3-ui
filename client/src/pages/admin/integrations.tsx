import { Key } from "lucide-react";
import { lazy, Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { TwitchIntegrationCard } from "@/components/settings/twitch-integration-card";
import { TwitchScopeStatus } from "@/components/settings/twitch-scope-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTwitchIntegration } from "@/hooks/use-twitch-integration";
import { IS_DESKTOP } from "@/lib/desktop";
import { cn } from "@/lib/utils";

// IS_DESKTOP is a build constant, so the web build carries none of the host's code.
const ThisComputerConnections = IS_DESKTOP
  ? lazy(() => import("@/desktop/LocalConnections").then((module) => ({ default: module.ThisComputerConnections })))
  : null;

/** Platforms woofx3 plans to support, listed so streamers can see they are on the way. */
const COMING_SOON_PLATFORMS = [
  { name: "YouTube", tileClass: "bg-red-600" },
  { name: "Discord", tileClass: "bg-blue-500" },
] as const;

export default function AdminIntegrations() {
  const { isConnected, twitchLink, isLoading: twitchLoading, health } = useTwitchIntegration();

  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Integrations" description="Connect the platforms and services this instance talks to." />
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Connected services</CardTitle>
          <CardDescription>Manage your connected streaming platforms.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TwitchIntegrationCard isConnected={isConnected} twitchLink={twitchLink} isLoading={twitchLoading} />
          {twitchLink && (
            <TwitchScopeStatus
              health={health}
              platformUsername={twitchLink.platformUsername}
              canRelink={twitchLink.viewerCanRelink}
            />
          )}
          {COMING_SOON_PLATFORMS.map((platform) => (
            <div
              key={platform.name}
              className="flex items-center justify-between p-4 rounded-lg border border-dashed"
              data-testid={`platform-coming-soon-${platform.name.toLowerCase()}`}
            >
              <div className="flex items-center gap-3 opacity-60">
                <div
                  className={cn(
                    "h-10 w-10 rounded flex items-center justify-center text-white font-bold",
                    platform.tileClass
                  )}
                >
                  {platform.name[0]}
                </div>
                <p className="font-medium">{platform.name}</p>
              </div>
              <Badge variant="outline" className="text-muted-foreground">
                Coming soon
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      {ThisComputerConnections && (
        <Suspense fallback={null}>
          <ThisComputerConnections />
        </Suspense>
      )}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">API keys</CardTitle>
          <CardDescription>Manage API keys for external integrations.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">You haven't created any API keys yet.</p>
            </div>
            <Button variant="outline" data-testid="button-create-api-key">
              <Key className="h-4 w-4 mr-2" />
              Create API Key
            </Button>
          </div>
        </CardContent>
      </Card>{" "}
    </div>
  );
}
