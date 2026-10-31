import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useConvexAuth, useMutation } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/hooks/use-instance";
import { useIsInstanceAdmin } from "@/hooks/use-instance-role";
import { actionErrorMessage } from "@/lib/action-error";
import { appLinkGate, needsAppLink } from "./app-link";
import { beginAppLink, companionLinkStatus, finishAppLink } from "./host";

interface OtherCompanion {
  deviceName: string;
  pairedAt: number;
  lastSeenAt: number | null;
}

type LinkView =
  | { kind: "idle" }
  | { kind: "askReplace"; instanceId: Id<"instances">; companion: OtherCompanion }
  | { kind: "replacing"; instanceId: Id<"instances">; companion: OtherCompanion }
  | { kind: "failed"; instanceId: Id<"instances">; message: string };

/**
 * Makes this computer the selected instance's companion once an admin is
 * signed in to the desktop app. The host generates and keeps the token; the
 * dashboard only carries its hash to Convex and tells the host when Convex
 * has recorded it. Says nothing unless it needs the person: another
 * computer is the companion already, or linking failed.
 */
export default function AppLink() {
  const { isAuthenticated } = useConvexAuth();
  if (!isAuthenticated) {
    return null;
  }
  return <SignedInAppLink />;
}

function SignedInAppLink() {
  const { instance, isLoading } = useInstance();
  const isAdmin = useIsInstanceAdmin();
  const linkSignedInApp = useMutation(api.companionPairing.linkSignedInApp);
  const attempted = useRef(new Set<string>());
  const [view, setView] = useState<LinkView>({ kind: "idle" });

  /** One pass at linking; `replaceOtherComputer` only once the person said so. */
  const link = useCallback(
    async (instanceId: Id<"instances">, replaceOtherComputer: boolean) => {
      try {
        if (!replaceOtherComputer && !needsAppLink(await companionLinkStatus(), instanceId)) {
          return;
        }
        const start = await beginAppLink();
        const result = await linkSignedInApp({ instanceId, ...start, replaceOtherComputer });
        if (result.kind === "otherCompanion") {
          setView({ kind: "askReplace", instanceId, companion: result.companion });
          return;
        }
        await finishAppLink({ instanceId: result.instanceId, instanceName: result.instanceName });
        setView({ kind: "idle" });
      } catch (error) {
        setView({ kind: "failed", instanceId, message: actionErrorMessage(error) });
      }
    },
    [linkSignedInApp]
  );

  const instanceId = isLoading ? undefined : (instance?._id ?? null);
  useEffect(() => {
    const gate = appLinkGate({ instanceId, isAdmin }, attempted.current);
    if (gate.kind !== "check") {
      return;
    }
    attempted.current.add(gate.instanceId);
    // A prompt about the instance left behind no longer applies.
    setView({ kind: "idle" });
    void link(gate.instanceId, false);
  }, [instanceId, isAdmin, link]);

  if (view.kind === "idle" || view.instanceId !== instanceId) {
    return null;
  }
  const dismiss = () => setView({ kind: "idle" });
  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-4 text-card-foreground shadow-lg"
      role={view.kind === "failed" ? "alert" : "status"}
      data-testid="desktop-app-link"
    >
      <button
        type="button"
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      {view.kind === "failed" ? (
        <>
          <p className="pr-6 text-sm font-medium">This computer could not connect to your instance</p>
          <p className="mt-1 text-sm text-muted-foreground">{view.message}</p>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setView({ kind: "idle" });
                void link(view.instanceId, false);
              }}
            >
              Try again
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="pr-6 text-sm font-medium">Use this computer for local connections?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {view.companion.deviceName} handles them now
            {view.companion.lastSeenAt === null
              ? ""
              : `, last seen ${formatDistanceToNow(view.companion.lastSeenAt, { addSuffix: true })}`}
            . Switching disconnects it.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={view.kind === "replacing"}>
              Keep {view.companion.deviceName}
            </Button>
            <Button
              size="sm"
              disabled={view.kind === "replacing"}
              onClick={() => {
                setView({ ...view, kind: "replacing" });
                void link(view.instanceId, true);
              }}
            >
              {view.kind === "replacing" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Use this computer
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
