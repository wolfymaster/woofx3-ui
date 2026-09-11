import { Key } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { TwitchIntegrationCard } from "@/components/settings/twitch-integration-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useInstance } from "@/hooks/use-instance";
import { useTwitchIntegration } from "@/hooks/use-twitch-integration";

export default function AdminIntegrations() {
  const { instance } = useInstance();
  const { isConnected, twitchLink, isLoading: twitchLoading } = useTwitchIntegration(instance?._id);

  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Integrations" description="Connect the platforms and services this instance talks to." />
      <Card>
        <CardHeader>
          <CardTitle>Connected Services</CardTitle>
          <CardDescription>Manage your connected streaming platforms.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TwitchIntegrationCard
            instanceId={instance?._id}
            isConnected={isConnected}
            twitchLink={twitchLink}
            isLoading={twitchLoading}
          />
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded bg-red-600 flex items-center justify-center text-white font-bold">
                Y
              </div>
              <div>
                <p className="font-medium">YouTube</p>
                <p className="text-sm text-muted-foreground">Not connected</p>
              </div>
            </div>
            <Button variant="outline" data-testid="button-connect-youtube">
              Connect
            </Button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded bg-blue-500 flex items-center justify-center text-white font-bold">
                D
              </div>
              <div>
                <p className="font-medium">Discord</p>
                <p className="text-sm text-muted-foreground">Not connected</p>
              </div>
            </div>
            <Button variant="outline" data-testid="button-connect-discord">
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
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
