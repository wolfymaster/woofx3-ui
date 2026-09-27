import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import { useConvexAuth, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-canvas";
import { useOptimisticInstanceQuery } from "@/hooks/use-optimistic-instance-query";
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
 * back to onboarding, where the provisioning progress screen takes over.
 */
export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const account = useQuery(api.accounts.getMyAccount);
  const instances = useQuery(api.instances.listForCurrentUser);
  const [, navigate] = useLocation();
  const [onDashboard] = useRoute("/");
  const hasRegisteredInstance = (instances ?? []).some((instance) => Boolean(instance?.clientId));
  const isChecking = account === undefined || instances === undefined;

  useEffect(() => {
    if (!isAuthenticated || isChecking) {
      return;
    }
    if (!account || !hasRegisteredInstance) {
      navigate("/auth/onboarding");
    }
  }, [isAuthenticated, isChecking, account, hasRegisteredInstance, navigate]);

  let content: ReactNode = children;
  if (isChecking) {
    content = <ContentPlaceholder onDashboard={onDashboard} />;
  } else if (!account || !hasRegisteredInstance) {
    content = null;
  }

  return (
    <>
      {onDashboard && <PrefetchDashboardPanels />}
      {content}
    </>
  );
}
