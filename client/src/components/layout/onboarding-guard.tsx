import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import { useConvexAuth, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { AskAdminToConnectTwitch } from "@/components/setup/twitch-step";
import { useInstance } from "@/hooks/use-instance";
import { useOptimisticInstanceQuery } from "@/hooks/use-optimistic-instance-query";
import { firstIncompleteStep, setupStepPath } from "@/lib/setup-steps";
import { $dashboardLayoutHint } from "@/lib/stores";

/**
 * Subscribes to the dashboard's panels from the moment the shell mounts, with
 * the cached instance id, so they load alongside the onboarding check instead
 * of a round trip after it. It renders nothing; the dashboard's own
 * subscription to the same query and args shares this one. It stays mounted
 * for as long as the dashboard route is, so the subscription is never dropped
 * and re-made in the commit that swaps the placeholder for the page.
 */
function PrefetchDashboardPanels() {
  useOptimisticInstanceQuery(api.dashboardLayouts.getPanels);
  return null;
}

function ContentPlaceholder({ onDashboard }: { onDashboard: boolean }) {
  const layoutHint = useStore($dashboardLayoutHint);
  if (onDashboard) {
    return <DashboardSkeleton layoutId={layoutHint} />;
  }
  return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Redirects users who haven't completed onboarding. Sits inside the shell and
 * gates only the content area, so the shell paints while the check is in flight.
 *
 * An instance row alone is not onboarding done: a managed engine has one from
 * the moment provisioning starts, and a failed bring-your-own registration
 * leaves one behind too. Only `clientId` says the handshake happened, which is
 * what every screen past this point depends on, so anything short of that goes
 * back to onboarding, which hands over to setup while the engine is built.
 *
 * The app also depends on Twitch, so an instance with no Twitch link goes to
 * setup until one exists. Only an owner or admin can connect it; anyone else
 * is told to ask one rather than sent somewhere they cannot act. The check is
 * that a link exists, not that it still works: a revoked or under-scoped link
 * is the reconnect banner's job, and must never bounce an established user
 * into setup.
 *
 * Setup also opens by itself once per user while the instance's setup is
 * unfinished, so a returning user is not sent back to it on every visit.
 */
export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const account = useQuery(api.accounts.getMyAccount);
  const { instance, instances, isLoading: instancesLoading } = useInstance();
  const setup = useQuery(api.setup.status, instance ? { instanceId: instance._id } : "skip");
  const [, navigate] = useLocation();
  const [onDashboard] = useRoute("/");
  const hasRegisteredInstance = instances.some((candidate) => Boolean(candidate?.clientId));
  const isChecking = account === undefined || instancesLoading || (instance !== null && setup === undefined);
  const needsOnboarding = !account || !hasRegisteredInstance;
  const needsTwitch = !needsOnboarding && setup !== undefined && setup !== null && setup.twitchUsername === null;

  useEffect(() => {
    if (!isAuthenticated || isChecking) {
      return;
    }
    if (needsOnboarding) {
      navigate("/auth/onboarding");
      return;
    }
    if (!setup?.canManageSetup) {
      return;
    }
    if (needsTwitch) {
      navigate(setupStepPath(firstIncompleteStep(setup)));
      return;
    }
    if (setup.completedAt === null && !setup.setupSeen) {
      navigate("/setup");
    }
  }, [isAuthenticated, isChecking, needsOnboarding, needsTwitch, setup, navigate]);

  let content: ReactNode = children;
  if (isChecking) {
    content = <ContentPlaceholder onDashboard={onDashboard} />;
  } else if (needsOnboarding) {
    content = null;
  } else if (needsTwitch) {
    content = setup?.canManageSetup ? null : (
      <div className="max-w-lg mx-auto p-6">
        <AskAdminToConnectTwitch />
      </div>
    );
  }

  return (
    <>
      {onDashboard && <PrefetchDashboardPanels />}
      {content}
    </>
  );
}
