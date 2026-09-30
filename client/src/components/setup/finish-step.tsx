import type { Id } from "@convex/_generated/dataModel";
import { starterPacksForInterests } from "@convex/lib/setupInterests";
import { findStarterPack } from "@convex/lib/starterPacks";
import type { SetupModuleInstall, SetupPackInstall, SetupStatus } from "@convex/setup";
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { $currentInstanceId } from "@/lib/stores";

interface FinishStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
}

type LineState = "waiting" | "done" | "attention";

function moduleLine(install: SetupModuleInstall | undefined): { state: LineState; text: string } {
  if (!install) {
    return { state: "waiting", text: "Installs when your engine is ready" };
  }
  if (install.status === "installed") {
    return { state: "done", text: "Installed" };
  }
  if (install.status === "needs_approval") {
    return { state: "attention", text: "Asks for new permissions; review it from the banner" };
  }
  return { state: "attention", text: "Install failed; retry it from the banner" };
}

function packLine(install: SetupPackInstall | undefined): { state: LineState; text: string } {
  if (!install || install.status === "pending") {
    return { state: "waiting", text: "Sets up after your platforms install" };
  }
  if (install.status === "installed") {
    return { state: "done", text: "Set up" };
  }
  return { state: "attention", text: install.error ?? "Could not be set up" };
}

function LineIcon({ state }: { state: LineState }) {
  if (state === "done") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />;
  }
  if (state === "attention") {
    return <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />;
  }
  return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

/**
 * Setup's last page: what will be installed and set up, and how far that has
 * got. The dashboard opens once the engine is registered; installs carry on in
 * the background and report problems in a banner across the app.
 */
export function FinishStep({ instanceId, status }: FinishStepProps) {
  const [, navigate] = useLocation();
  // Someone who waits here for their engine is taken to the dashboard when it
  // is ready; someone whose engine was already ready reads the summary first.
  const registeredOnArrival = useRef(status.engineRegistered);

  const openDashboard = () => {
    $currentInstanceId.set(instanceId);
    navigate("/");
  };

  useEffect(() => {
    if (status.engineRegistered && !registeredOnArrival.current) {
      $currentInstanceId.set(instanceId);
      navigate("/");
    }
  }, [status.engineRegistered, instanceId, navigate]);

  const chosenIds = status.platforms.map((platform) => platform.marketplaceModuleId);
  const packIds = starterPacksForInterests(status.interests, chosenIds);
  const moduleInstalls = new Map(status.moduleInstalls.map((entry) => [entry.marketplaceModuleId, entry]));
  const packInstalls = new Map(status.packInstalls.map((entry) => [entry.packId, entry]));

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        We&apos;ll install your platforms and set these up as soon as your engine is ready.
      </p>

      <ul className="space-y-2" data-testid="list-setup-summary">
        {status.platforms.map((platform) => {
          const line = moduleLine(moduleInstalls.get(platform.marketplaceModuleId));
          return (
            <li key={platform.marketplaceModuleId} className="flex items-start gap-2">
              <LineIcon state={line.state} />
              <span className="font-medium">{platform.name ?? platform.marketplaceModuleId}</span>
              <span className="text-muted-foreground">{line.text}</span>
            </li>
          );
        })}
        {packIds.map((packId) => {
          const line = packLine(packInstalls.get(packId));
          return (
            <li key={packId} className="flex items-start gap-2">
              <LineIcon state={line.state} />
              <span className="font-medium">{findStarterPack(packId)?.name ?? packId}</span>
              <span className="text-muted-foreground">{line.text}</span>
            </li>
          );
        })}
      </ul>

      {status.engineRegistered ? (
        <Button className="w-full" onClick={openDashboard} data-testid="button-open-dashboard">
          Open your dashboard
        </Button>
      ) : (
        <p className="flex items-center gap-2 text-muted-foreground" data-testid="text-waiting-for-engine">
          <Loader2 className="h-4 w-4 animate-spin" />
          Your dashboard opens as soon as your engine is ready.
        </p>
      )}
    </div>
  );
}
