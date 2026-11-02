import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, MonitorPlay } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { DashboardStep } from "@/components/setup/dashboard-step";
import { EngineSplash } from "@/components/setup/engine-splash";
import { ImportStep } from "@/components/setup/import-step";
import { InterestsStep } from "@/components/setup/interests-step";
import { OverlayPage } from "@/components/setup/overlay-page";
import { PlatformsStep } from "@/components/setup/platforms-step";
import { ProvisioningBar } from "@/components/setup/provisioning-bar";
import { AskAdminToConnectTwitch, TwitchStep } from "@/components/setup/twitch-step";
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
import { cn } from "@/lib/utils";

interface SetupShellProps {
  activeStep: SetupStepId | null;
  /** Null while the setup status is loading; the product name stands in until then. */
  workspaceName: string | null;
  children: React.ReactNode;
}

function SetupShell({ activeStep, workspaceName, children }: SetupShellProps) {
  const activeIndex = activeStep === null ? -1 : setupStepIndex(activeStep);
  return (
    <div className="min-h-screen bg-background flex justify-center p-4 sm:pt-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground">
            <MonitorPlay className="h-5 w-5" />
          </div>
          <span className="font-bold text-2xl tracking-tight min-w-0 truncate" data-testid="text-setup-workspace-name">
            {workspaceName ?? "woofx3"}
          </span>
        </div>
        {activeStep !== null && (
          <ol className="flex items-center justify-center gap-2" aria-label="Setup progress">
            {SETUP_STEPS.map((step, index) => (
              <li key={step.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium",
                    index < activeIndex && "bg-primary text-primary-foreground",
                    index === activeIndex && "bg-primary/20 text-primary border-2 border-primary",
                    index > activeIndex && "bg-muted text-muted-foreground"
                  )}
                  aria-current={index === activeIndex ? "step" : undefined}
                >
                  {index < activeIndex ? <Check className="h-4 w-4" /> : index + 1}
                  <span className="sr-only">{step.title}</span>
                </span>
                {index < SETUP_STEPS.length - 1 && (
                  <span className={cn("h-px w-10", index < activeIndex ? "bg-primary" : "bg-muted")} />
                )}
              </li>
            ))}
          </ol>
        )}
        {children}
      </div>
    </div>
  );
}

interface HostedStepProps {
  instanceId: Id<"instances">;
  engineRegistered: boolean;
}

function HostedOverlayPage({ instanceId, engineRegistered, onExit }: HostedStepProps & { onExit: () => void }) {
  return <OverlayPage engine={useEngineBuild(instanceId, engineRegistered)} onExit={onExit} />;
}

/** The last stop: the wait for a build still running, and straight through to the dashboard otherwise. */
function HostedSplash({ instanceId, engineRegistered }: HostedStepProps) {
  const [, navigate] = useLocation();
  const openDashboard = useCallback(() => {
    $currentInstanceId.set(instanceId);
    navigate("/");
  }, [instanceId, navigate]);
  return <EngineSplash build={useEngineBuild(instanceId, engineRegistered)} onReady={openDashboard} />;
}

/**
 * The setup wizard, one route per step (/setup/:step). It runs while a
 * managed engine is still being built, with the build's progress above it.
 * Steps that must be done in order are enforced here: a later step's URL
 * opened early lands on the first one still to do. A finished step asks to go
 * on through `goTo`, which waits for the setup status to record it (see
 * setupRedirect).
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
      <SetupShell activeStep={null} workspaceName={status?.workspaceName ?? null}>
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
      <SetupShell activeStep={null} workspaceName={status.workspaceName}>
        {status.twitchUsername === null ? (
          <AskAdminToConnectTwitch />
        ) : (
          <div className="rounded-md border p-4 space-y-3 text-sm" data-testid="text-setup-admin-only">
            <p>Only an owner or admin can change this account&apos;s setup.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Back to the dashboard</Link>
            </Button>
          </div>
        )}
      </SetupShell>
    );
  }

  if (step === "overlay") {
    return (
      <HostedOverlayPage
        instanceId={instanceId}
        engineRegistered={status.engineRegistered}
        onExit={() => goTo("finish")}
      />
    );
  }
  if (step === "finish") {
    return <HostedSplash instanceId={instanceId} engineRegistered={status.engineRegistered} />;
  }

  const title = SETUP_STEPS[setupStepIndex(step)].title;

  return (
    <SetupShell activeStep={step} workspaceName={status.workspaceName}>
      <ProvisioningBar instanceId={instanceId} />
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-setup-step-title">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === "platforms" && (
            <PlatformsStep instanceId={instanceId} status={status} onContinue={() => goTo("twitch")} />
          )}
          {step === "twitch" && <TwitchStep status={status} onContinue={() => goTo("import")} />}
          {step === "import" && (
            <ImportStep instanceId={instanceId} status={status} onContinue={() => goTo("interests")} />
          )}
          {step === "interests" && (
            <InterestsStep instanceId={instanceId} status={status} onContinue={() => goTo("dashboard")} />
          )}
          {step === "dashboard" && (
            <DashboardStep instanceId={instanceId} status={status} onContinue={() => goTo("overlay")} />
          )}
        </CardContent>
      </Card>
    </SetupShell>
  );
}
