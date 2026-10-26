import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { canManageTwitchLink } from "@convex/lib/twitchLinkPolicy";
import { useQuery } from "convex/react";
import { Loader2, Unlink } from "lucide-react";
import { useState } from "react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EngineUnreachableError } from "@/engine/errors";
import { useRetryEngineSyncRequest, useUnlinkTwitchRequest } from "@/engine/hooks/use-twitch-link";
import { useTwitchConnect } from "@/hooks/use-twitch-connect";
import { actionErrorMessage } from "@/lib/action-error";
import { hasEnginePending, withoutEnginePending } from "@/lib/twitch-connect-return";

/** Why the last disconnect did not remove the link; only an unreachable engine can be forced. */
interface UnlinkFailure {
  message: string;
  engineUnreachable: boolean;
}

interface TwitchIntegrationCardProps {
  instanceId: Id<"instances"> | undefined;
  isConnected: boolean;
  twitchLink?: {
    platformUsername: string;
    platformUserId: string;
    profileImageUrl?: string;
  } | null;
  isLoading: boolean;
}

export function TwitchIntegrationCard({ instanceId, isConnected, twitchLink, isLoading }: TwitchIntegrationCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [unlinkFailure, setUnlinkFailure] = useState<UnlinkFailure | null>(null);
  const [unlinkWarning, setUnlinkWarning] = useState<string | null>(null);
  const [enginePending, setEnginePending] = useState(() => hasEnginePending(window.location.search));
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const unlink = useUnlinkTwitchRequest();
  const retryEngineSync = useRetryEngineSyncRequest();
  const { connect, starting, error: connectError } = useTwitchConnect();
  // The server refuses a member's connect or disconnect; this only keeps the
  // buttons from offering what will be refused. Undefined while loading, which
  // leaves them disabled rather than flashing enabled.
  const viewerRole = useQuery(api.instances.viewerRole, instanceId ? { instanceId } : "skip");
  const canManage = canManageTwitchLink(viewerRole);

  const clearEnginePendingMarker = () => {
    window.history.replaceState(null, "", `${window.location.pathname}${withoutEnginePending(window.location.search)}`);
    setEnginePending(false);
  };

  // Shown in both card states: a forced removal deletes the link, which flips
  // the card to "Not connected" while the warning still applies.
  const unlinkWarningNote = unlinkWarning && (
    <p className="text-sm text-muted-foreground" data-testid="text-disconnect-twitch-warning">
      {unlinkWarning}
    </p>
  );

  const handleConnect = () => {
    setUnlinkWarning(null);
    connect("/admin/integrations");
  };

  const handleDisconnect = async (force: boolean) => {
    setIsDisconnecting(true);
    try {
      const result = await unlink({ force });
      setUnlinkFailure(null);
      setUnlinkWarning(result.warning ?? null);
      clearEnginePendingMarker();
      setConfirmOpen(false);
    } catch (err) {
      console.error("Failed to disconnect Twitch:", err);
      setUnlinkFailure({ message: actionErrorMessage(err), engineUnreachable: err instanceof EngineUnreachableError });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryError(null);
    try {
      await retryEngineSync();
      clearEnginePendingMarker();
    } catch (err) {
      console.error("Failed to hand Twitch to the engine:", err);
      setRetryError(actionErrorMessage(err));
    } finally {
      setIsRetrying(false);
    }
  };

  const handleConfirmOpenChange = (open: boolean) => {
    setConfirmOpen(open);
    if (!open) {
      setUnlinkFailure(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-between p-4 rounded-lg border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-purple-600 flex items-center justify-center text-white font-bold">T</div>
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
              {twitchLink.profileImageUrl ? (
                <AvatarImage src={twitchLink.profileImageUrl} alt={twitchLink.platformUsername} />
              ) : null}
              <AvatarFallback className="bg-purple-600 text-white">
                {twitchLink.platformUsername.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">Twitch</p>
              <p className="text-sm text-muted-foreground">Connected as {twitchLink.platformUsername}</p>
            </div>
          </div>
          {canManage ? (
            <Button
              variant="outline"
              onClick={() => handleConfirmOpenChange(true)}
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
          ) : (
            <p className="text-xs text-muted-foreground">Only an owner or admin can disconnect Twitch.</p>
          )}
        </div>

        {enginePending && canManage && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-500/50 text-sm">
            <div>
              <p>Connected, but your engine has not picked it up yet.</p>
              {retryError && <p className="text-destructive">{retryError}</p>}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={isRetrying}
              data-testid="button-retry-twitch-sync"
            >
              {isRetrying && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Retry
            </Button>
          </div>
        )}
        {unlinkWarningNote}

        <AlertDialog open={confirmOpen} onOpenChange={handleConfirmOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Twitch</AlertDialogTitle>
              <AlertDialogDescription>
                This turns off Twitch in your engine and stops all Twitch actions and triggers.
              </AlertDialogDescription>
              {unlinkFailure && (
                <p className="text-sm text-destructive" data-testid="text-disconnect-twitch-error">
                  {unlinkFailure.message}
                </p>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  // Keep the dialog open so a refusal can be read and, for an unreachable engine, forced.
                  event.preventDefault();
                  handleDisconnect(unlinkFailure?.engineUnreachable === true);
                }}
                disabled={isDisconnecting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDisconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Unlink className="h-4 w-4 mr-2" />
                )}
                {unlinkFailure?.engineUnreachable ? "Remove anyway" : "Disconnect"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between p-4 rounded-lg border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-purple-600 flex items-center justify-center text-white font-bold">T</div>
          <div>
            <p className="font-medium">Twitch</p>
            <p className="text-sm text-muted-foreground">Not connected</p>
            {connectError && <p className="text-sm text-destructive">{connectError}</p>}
            {viewerRole !== undefined && !canManage && (
              <p className="text-xs text-muted-foreground">Only an owner or admin can connect Twitch.</p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleConnect}
          disabled={!instanceId || !canManage || starting}
          data-testid="button-connect-twitch"
        >
          {starting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Connect
        </Button>
      </div>
      {unlinkWarningNote}
    </>
  );
}
