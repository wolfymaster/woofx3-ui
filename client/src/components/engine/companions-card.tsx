import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { roleSatisfies } from "@convex/lib/instanceRoles";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { format, formatDistanceToNow } from "date-fns";
import { Laptop, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

/** A companion heartbeats every 60 s, so three missed beats reads as offline. */
const ONLINE_WINDOW_MS = 3 * 60_000;

/**
 * `listForInstance` does not re-run as time passes, so the card keeps its own
 * clock and an online badge ages to "last seen" without new data.
 */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return now;
}

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    return String(error.data);
  }
  return error instanceof Error ? error.message : String(error);
}

interface RevokeTarget {
  companionId: Id<"companions">;
  deviceName: string;
}

export function CompanionsCard({ instanceId }: { instanceId: Id<"instances"> }) {
  const companions = useQuery(api.companions.listForInstance, { instanceId });
  const viewerRole = useQuery(api.instances.viewerRole, { instanceId });
  const canRevoke = roleSatisfies(viewerRole, "admin");
  const revoke = useMutation(api.companions.revoke);
  const { toast } = useToast();
  const now = useMinuteClock();
  const [target, setTarget] = useState<RevokeTarget | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function confirmRevoke() {
    if (!target) {
      return;
    }
    setRevoking(true);
    try {
      await revoke({ companionId: target.companionId });
      setTarget(null);
    } catch (error) {
      toast({ title: "Couldn't revoke companion", description: errorMessage(error), variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Companions</CardTitle>
        <CardDescription>Computers paired with this instance through the woofx3 companion app.</CardDescription>
      </CardHeader>
      <CardContent>
        {companions === undefined ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : companions.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-companions">
            No companion paired. Install the woofx3 companion on your streaming PC to connect OBS and other local apps.
          </p>
        ) : (
          <ul className="divide-y">
            {companions.map((companion) => {
              const online = companion.lastSeenAt !== null && now - companion.lastSeenAt < ONLINE_WINDOW_MS;
              return (
                <li
                  key={companion.companionId}
                  className="flex flex-wrap items-center gap-3 py-3"
                  data-testid={`row-companion-${companion.companionId}`}
                >
                  <Laptop className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{companion.deviceName}</p>
                    <p className="text-xs text-muted-foreground">
                      Version {companion.companionVersion} · paired {format(new Date(companion.pairedAt), "PP")}
                    </p>
                  </div>
                  {!companion.approvalStands ? (
                    <Badge variant="outline" title="Whoever approved it is no longer an admin of this instance">
                      Needs pairing again
                    </Badge>
                  ) : !companion.confirmed ? (
                    <Badge variant="outline">Awaiting confirmation on the device</Badge>
                  ) : online ? (
                    <Badge>Online</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {companion.lastSeenAt === null
                        ? "Never connected"
                        : `Last seen ${formatDistanceToNow(new Date(companion.lastSeenAt), { addSuffix: true })}`}
                    </span>
                  )}
                  {canRevoke && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setTarget({ companionId: companion.companionId, deviceName: companion.deviceName })
                      }
                      data-testid={`button-revoke-companion-${companion.companionId}`}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke companion?</AlertDialogTitle>
            <AlertDialogDescription>
              The companion on {target?.deviceName} stops working at once and must be paired again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRevoke();
              }}
              disabled={revoking}
              data-testid="button-confirm-revoke-companion"
            >
              {revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
