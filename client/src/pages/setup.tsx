import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SetupStatus } from "@convex/setup";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ConnectStep } from "@/components/setup/connect-step";
import { EngineSplash } from "@/components/setup/engine-splash";
import { OverlayPage } from "@/components/setup/overlay-page";
import { ProvisioningBar } from "@/components/setup/provisioning-bar";
import { SetupShell } from "@/components/setup/setup-shell";
import { AskAdminToConnectTwitch } from "@/components/setup/twitch-step";
import { useEngineBuild } from "@/components/setup/use-engine-build";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInstance } from "@/hooks/use-instance";
import {
  allowedSetupStep,
  isSetupStepId,
  SETUP_STEPS,
  type SetupStepId,
  setupRedirect,
  setupStepIndex,
  setupStepPath,
} from "@/lib/setup-steps";
import { $currentInstanceId } from "@/lib/stores";

interface HostedStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
}

function HostedOverlayPage({ instanceId, status, onExit }: HostedStepProps & { onExit: () => void }) {
  return <OverlayPage engine={useEngineBuild(instanceId, status)} onExit={onExit} />;
}

/** The last stop: the wait for a build still running, and straight through to the dashboard otherwise. */
function HostedSplash({ instanceId, status }: HostedStepProps) {
  const [, navigate] = useLocation();
  const openDashboard = useCallback(() => {
    $currentInstanceId.set(instanceId);
    navigate("/");
  }, [instanceId, navigate]);
  return <EngineSplash build={useEngineBuild(instanceId, status)} onReady={openDashboard} />;
}

/**
 * First-run setup, one route per step (/setup/:step). It runs while a managed
 * engine is still being built, with the build's progress above it. Order is
 * enforced here: any other step's URL, including ones that no longer exist,
 * lands where the user belongs. A finished step asks to go on through `goTo`,
 * which waits for the setup status to record it (see setupRedirect).
 */
export default function Setup() {
  const params = useParams<{ step?: string }>();
  const [, navigate] = useLocation();
  const { instance, isLoading: instancesLoading } = useInstance();
  const status = useQuery(api.setup.status, instance ? { instanceId: instance._id } : "skip");
  const markSeen = useMutation(api.setup.markSeen);
  const markedSeen = useRef(false);
  const [advancingTo, setAdvancingTo] = useState<SetupStepId | null>(null);

  const requestedStep = isSetupStepId(params.step) ? params.step : null;
  const step = status && requestedStep ? allowedSetupStep(requestedStep, status) : null;

  useEffect(() => {
    if (!instancesLoading && !instance) {
      navigate("/auth/onboarding", { replace: true });
    }
  }, [instancesLoading, instance, navigate]);

  useEffect(() => {
    if (!status || markedSeen.current) {
      return;
    }
    markedSeen.current = true;
    void markSeen({});
  }, [status, markSeen]);

  useEffect(() => {
    if (!status) {
      return;
    }
    if (advancingTo !== null && advancingTo === requestedStep) {
      setAdvancingTo(null);
      return;
    }
    const redirect = setupRedirect(requestedStep, advancingTo, status);
    if (redirect) {
      navigate(setupStepPath(redirect.step), { replace: redirect.replace });
    }
  }, [status, requestedStep, advancingTo, navigate]);

  if (!instance || !status || !step) {
    return (
      <SetupShell activeStep={null}>
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </SetupShell>
    );
  }

  const instanceId = instance._id;
  const goTo = (next: SetupStepId) => setAdvancingTo(next);

  if (!status.canManageSetup) {
    return (
      <SetupShell activeStep={null}>
        {status.twitchUsername === null ? (
          <AskAdminToConnectTwitch />
        ) : (
          <div className="rounded-md border p-4 space-y-3 text-sm" data-testid="text-setup-admin-only">
            <p>Only an owner or admin can change this organization&apos;s setup.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Back to the dashboard</Link>
            </Button>
          </div>
        )}
      </SetupShell>
    );
  }

  if (step === "overlay") {
    return <HostedOverlayPage instanceId={instanceId} status={status} onExit={() => goTo("finish")} />;
  }
  if (step === "finish") {
    return <HostedSplash instanceId={instanceId} status={status} />;
  }

  const title = SETUP_STEPS[setupStepIndex(step)].title;

  return (
    <SetupShell activeStep={step}>
      {!status.usernameNeeded && <ProvisioningBar instanceId={instanceId} />}
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-setup-step-title">{title}</CardTitle>
        </CardHeader>
        <CardContent>{step === "connect" && <ConnectStep instanceId={instanceId} status={status} />}</CardContent>
      </Card>
    </SetupShell>
  );
}
