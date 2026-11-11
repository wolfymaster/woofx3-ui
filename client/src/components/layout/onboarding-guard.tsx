import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import { useConvexAuth, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { SuspendedEngine } from "@/components/layout/suspended-engine";
import { AskAdminToConnectTwitch } from "@/components/setup/twitch-step";
import { useInstance } from "@/hooks/use-instance";
import { useOptimisticInstanceQuery } from "@/hooks/use-optimistic-instance-query";
import { firstIncompleteStep, overlayPageRedirects, setupStepPath } from "@/lib/setup-steps";
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
 * Redirects users who can't use the dashboard yet. Sits inside the shell and
 * gates only the content area, so the shell paints while the check is in flight.
 *
 * The dashboard needs an engine: where to go is the server's answer
 * (`access.entry`). A user with no registered engine, their own or one they
 * were invited to, is sent to onboarding, which passes them on to wherever
 * setup is: connecting, or the overlay page while the engine is built. That
 * holds across a refresh or a return days later, and for someone removed from
 * their only engine. A selected engine that isn't usable is swapped for the
 * one the server chose. A hosted engine whose organization is suspended shows
 * the suspended page instead of its content. Someone who only uses another
 * account's engine, such as a moderator who does not stream, is never sent to
 * onboarding.
 *
 * The app also depends on Twitch, so an instance with no Twitch link goes to
 * setup until one exists. Only an owner or admin can connect it; anyone else
 * is told to ask one rather than sent somewhere they cannot act. The check is
 * that a link exists, not that it still works: a revoked or under-scoped link
 * is the reconnect banner's job, and must never bounce an established user
 * into setup. A preview deployment where Twitch was skipped does not need a
 * link (`SetupStatus.twitchRequired`).
 *
 * Setup also opens by itself once per user while the instance's setup is
 * unfinished, so a returning user is not sent back to it on every visit.
 *
 * A finished setup that was seeded sends an owner or admin to the overlay page
 * until one of them has seen a test alert play or skipped it
 * (`SetupStatus.overlayPending`), so someone who left midway comes back to it
 * and someone who passed it never does. The alerts page is exempt, since the
 * overlay page sends them there to make the follow alert it needs.
 */
export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const { instance, optimisticInstanceId, setInstance } = useInstance();
  const entry = useQuery(api.access.entry, isAuthenticated ? { selectedInstanceId: optimisticInstanceId } : "skip");
  const enteredEngine = entry?.kind === "engine" && entry.instanceId === instance?._id;
  const setup = useQuery(api.setup.status, instance ? { instanceId: instance._id } : "skip");
  const [location, navigate] = useLocation();
  const [onDashboard] = useRoute("/");
  const switching = entry?.kind === "engine" && !enteredEngine;
  const isChecking = entry === undefined || entry === null || switching || (enteredEngine && setup === undefined);
  const needsOnboarding = entry?.kind === "createEngine";
  const needsTwitch =
    enteredEngine && setup !== undefined && setup !== null && setup.twitchRequired && setup.twitchUsername === null;

  useEffect(() => {
    if (switching && entry?.kind === "engine") {
      setInstance(entry.instanceId);
    }
  }, [switching, entry, setInstance]);

  useEffect(() => {
    if (!isAuthenticated || isChecking || entry?.kind === "suspended") {
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
      return;
    }
    if (overlayPageRedirects(setup.overlayPending, location)) {
      navigate(setupStepPath("overlay"));
    }
  }, [isAuthenticated, isChecking, entry, needsOnboarding, needsTwitch, setup, location, navigate]);

  let content: ReactNode = children;
  if (isChecking) {
    content = <ContentPlaceholder onDashboard={onDashboard} />;
  } else if (needsOnboarding) {
    content = null;
  } else if (entry?.kind === "suspended") {
    content = <SuspendedEngine entry={entry} />;
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
