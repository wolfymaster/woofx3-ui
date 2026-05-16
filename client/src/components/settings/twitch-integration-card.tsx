import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Unlink } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";

interface TwitchIntegrationCardProps {
  instanceId: Id<"instances"> | undefined;
  isConnected: boolean;
  twitchLink?: {
    platformUsername: string;
    platformUserId: string;
  } | null;
  isLoading: boolean;
}

export function TwitchIntegrationCard({
  instanceId,
  isConnected,
  twitchLink,
  isLoading,
}: TwitchIntegrationCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const disconnect = useMutation(api.twitchIntegration.disconnect);

  const handleConnect = () => {
    if (!instanceId) return;
    const redirectTo = encodeURIComponent("/settings?tab=integrations");
    window.location.href = `/api/integrations/twitch/start?instanceId=${instanceId}&redirect_to=${redirectTo}`;
  };

  const handleDisconnect = async () => {
    if (!instanceId) return;
    setIsDisconnecting(true);
    try {
      await disconnect({ instanceId, platform: "twitch" });
    } catch (err) {
      console.error("Failed to disconnect Twitch:", err);
    } finally {
      setIsDisconnecting(false);
      setConfirmOpen(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-between p-4 rounded-lg border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-purple-600 flex items-center justify-center text-white font-bold">
            T
          </div>
          <div>
            <p className="font-medium">Twitch</p>
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isConnected && twitchLink) {
    return (
      <>
        <div className="flex items-center justify-between p-4 rounded-lg border">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${twitchLink.platformUsername}`} />
              <AvatarFallback className="bg-purple-600 text-white">
                {twitchLink.platformUsername.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">Twitch</p>
              <p className="text-sm text-muted-foreground">
                Connected as {twitchLink.platformUsername}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={isDisconnecting}
            data-testid="button-disconnect-twitch"
          >
            {isDisconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Unlink className="h-4 w-4 mr-2" />
            )}
            Disconnect
          </Button>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Twitch</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to disconnect your Twitch account? This will stop all Twitch-related
                actions and triggers for this instance.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDisconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Unlink className="h-4 w-4 mr-2" />
                )}
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <div className="flex items-center justify-between p-4 rounded-lg border">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded bg-purple-600 flex items-center justify-center text-white font-bold">
          T
        </div>
        <div>
          <p className="font-medium">Twitch</p>
          <p className="text-sm text-muted-foreground">Not connected</p>
        </div>
      </div>
      <Button
        variant="outline"
        onClick={handleConnect}
        disabled={!instanceId}
        data-testid="button-connect-twitch"
      >
        Connect
      </Button>
    </div>
  );
}
