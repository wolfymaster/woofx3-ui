import { api } from "@convex/_generated/api";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ConvexProvider, useConvexAuth, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { BroadcastShell } from "@/components/layout/broadcast-shell";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ALERT_EDITOR_ROUTE } from "@/lib/alert-editor-route";
import { ALERT_RUN_ROUTE } from "@/lib/alert-run-route";
import {
  COMMAND_EDITOR_ROUTE,
  COMMAND_GROUP_EDITOR_ROUTE,
  COMMAND_GROUP_NEW_ROUTE,
  COMMAND_GROUPS_PATH,
  COMMAND_NEW_ROUTE,
  COMMAND_STEP_ALERT_ROUTE,
} from "@/lib/command-editor-route";
import AdminAppearance from "@/pages/admin/appearance";
import AdminEngine from "@/pages/admin/engine";
import AdminIntegrations from "@/pages/admin/integrations";
import AdminStorage from "@/pages/admin/storage";
import AlertEditor from "@/pages/alert-editor";
import AlertRun from "@/pages/alert-run";
import Alerts from "@/pages/alerts";
import Assets from "@/pages/assets";
import AcceptInvite from "@/pages/auth/accept-invite";
import Login from "@/pages/auth/login";
import Onboarding from "@/pages/auth/onboarding";
import Register from "@/pages/auth/register";
import TwitchCallback from "@/pages/auth/twitch-callback";
import CommandEditor from "@/pages/command-editor";
import CommandGroupEditor from "@/pages/command-group-editor";
import CommandStepAlertEditor from "@/pages/command-step-alert-editor";
import Commands from "@/pages/commands";
import Counters from "@/pages/counters";
import Dashboard from "@/pages/dashboard";
import Feedback from "@/pages/feedback";
import Learning from "@/pages/learning";
import Logs from "@/pages/logs";
import ModuleInstall from "@/pages/module-install";
import Modules from "@/pages/modules";
import NotFound from "@/pages/not-found";
import Queues from "@/pages/queues";
import Scenes from "@/pages/scenes";

import Team from "@/pages/team";
import Timers from "@/pages/timers";
import Workflows from "@/pages/workflows";
import { convexClient as convex } from "./lib/convexClient";
import { queryClient } from "./lib/queryClient";

console.log("url", import.meta.env.VITE_CONVEX_URL);

function SplashScreen() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

// Redirects unauthenticated users to login
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const current = window.location.pathname + window.location.search;
      const nextParam = current === "/" ? "" : `?next=${encodeURIComponent(current)}`;
      navigate(`/auth/login${nextParam}`);
    }
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading) return <SplashScreen />;
  if (!isAuthenticated) return null;
  return <>{children}</>;
}

// Redirects users who haven't completed onboarding.
//
// An instance row alone is not onboarding done: a managed engine has one from
// the moment provisioning starts, and a failed bring-your-own registration
// leaves one behind too. Only `clientId` says the handshake happened, which is
// what every screen past this point depends on, so anything short of that goes
// back to onboarding — where the provisioning progress screen takes over.
function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const account = useQuery(api.accounts.getMyAccount);
  const instances = useQuery(api.instances.listForCurrentUser);
  const [, navigate] = useLocation();
  const hasRegisteredInstance = (instances ?? []).some((instance) => Boolean(instance?.clientId));

  useEffect(() => {
    if (!isAuthenticated) return;
    if (account === undefined || instances === undefined) return; // still loading

    if (!account || !hasRegisteredInstance) {
      navigate("/auth/onboarding");
    }
  }, [isAuthenticated, account, instances, hasRegisteredInstance, navigate]);

  if (account === undefined || instances === undefined) return <SplashScreen />;
  if (!account || !hasRegisteredInstance) return null;
  return <>{children}</>;
}

/** Legacy `/settings/:tab` values that still map onto an Admin screen. */
const ADMIN_PATHS = new Set(["engine", "integrations", "storage", "appearance"]);

// Wouter has no <Redirect> component; navigate in an effect instead.
function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();

  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);

  return null;
}

function AppRoutes() {
  const [location] = useLocation();

  return (
    <Switch>
      {/* Auth routes — accessible without authentication */}
      <Route path="/auth/login" component={Login} />
      <Route path="/auth/register" component={Register} />
      <Route path="/auth/twitch/callback" component={TwitchCallback} />
      <Route path="/auth/accept-invite" component={AcceptInvite} />
      <Route path="/auth/onboarding">
        <AuthGuard>
          <Onboarding />
        </AuthGuard>
      </Route>

      {/* Protected app routes */}
      <Route>
        <AuthGuard>
          <OnboardingGuard>
            <BroadcastShell>
              <ErrorBoundary resetKey={location}>
                <Switch>
                  <Route path="/" component={Dashboard} />

                  {/* Stream section */}
                  <Route path="/stream">
                    <Redirect to="/stream/alerts" />
                  </Route>
                  <Route path="/stream/alerts" component={Alerts} />
                  <Route path="/stream/alerts/*" component={Alerts} />
                  <Route path={ALERT_EDITOR_ROUTE} component={AlertEditor} />
                  <Route path={ALERT_RUN_ROUTE} component={AlertRun} />
                  {/* Order matters: the fixed segments must be matched before :engineCommandId. */}
                  <Route path={COMMAND_STEP_ALERT_ROUTE} component={CommandStepAlertEditor} />
                  <Route path={COMMAND_GROUP_NEW_ROUTE} component={CommandGroupEditor} />
                  <Route path={COMMAND_GROUP_EDITOR_ROUTE} component={CommandGroupEditor} />
                  <Route path={COMMAND_GROUPS_PATH} component={Commands} />
                  <Route path={COMMAND_NEW_ROUTE} component={CommandEditor} />
                  <Route path={COMMAND_EDITOR_ROUTE} component={CommandEditor} />
                  <Route path="/stream/commands" component={Commands} />
                  <Route path="/stream/counters" component={Counters} />
                  <Route path="/stream/counters/*" component={Counters} />
                  <Route path="/stream/timers" component={Timers} />
                  <Route path="/stream/timers/*" component={Timers} />
                  <Route path="/stream/queues" component={Queues} />
                  <Route path="/stream/queues/*" component={Queues} />
                  <Route path="/stream/scenes" component={Scenes} />
                  <Route path="/stream/scenes/:id" component={Scenes} />
                  <Route path="/stream/assets" component={Assets} />
                  <Route path="/stream/workflows" component={Workflows} />
                  <Route path="/stream/workflows/new" component={Workflows} />
                  <Route path="/stream/workflows/:id" component={Workflows} />
                  <Route path="/stream/workflows/:id/edit" component={Workflows} />

                  {/* Modules section */}
                  <Route path="/modules/install" component={ModuleInstall} />
                  <Route path="/modules/installed" component={Modules} />
                  <Route path="/modules/:moduleId" component={Modules} />
                  <Route path="/modules" component={Modules} />

                  {/* Help section */}
                  <Route path="/help">
                    <Redirect to="/help/learning" />
                  </Route>
                  <Route path="/help/learning" component={Learning} />
                  <Route path="/help/logs" component={Logs} />
                  <Route path="/help/feedback" component={Feedback} />

                  {/* Admin section */}
                  <Route path="/admin">
                    <Redirect to="/admin/engine" />
                  </Route>
                  <Route path="/admin/engine" component={AdminEngine} />
                  <Route path="/admin/integrations" component={AdminIntegrations} />
                  <Route path="/admin/storage" component={AdminStorage} />
                  <Route path="/admin/appearance" component={AdminAppearance} />

                  <Route path="/team" component={Team} />

                  {/* Legacy top-level paths, kept so existing links survive the menu restructure. */}
                  <Route path="/alerts">
                    <Redirect to="/stream/alerts" />
                  </Route>
                  <Route path="/commands">
                    <Redirect to="/stream/commands" />
                  </Route>
                  <Route path="/assets">
                    <Redirect to="/stream/assets" />
                  </Route>
                  <Route path="/workflows">
                    <Redirect to="/stream/workflows" />
                  </Route>
                  <Route path="/workflows/:id">{(params) => <Redirect to={`/stream/workflows/${params.id}`} />}</Route>
                  <Route path="/workflows/:id/edit">
                    {(params) => <Redirect to={`/stream/workflows/${params.id}/edit`} />}
                  </Route>
                  <Route path="/scenes">
                    <Redirect to="/stream/scenes" />
                  </Route>
                  <Route path="/scenes/:id">{(params) => <Redirect to={`/stream/scenes/${params.id}`} />}</Route>
                  {/* Runs are reached from the alert they fired, one at a time. */}
                  <Route path="/stream/alert-history">
                    <Redirect to="/stream/alerts" />
                  </Route>
                  {/* Test events moved onto the Alerts screen, beside each event. */}
                  <Route path="/debug">
                    <Redirect to="/stream/alerts" />
                  </Route>
                  <Route path="/help/debug">
                    <Redirect to="/stream/alerts" />
                  </Route>
                  <Route path="/settings/:tab?">
                    {(params) => (
                      <Redirect to={ADMIN_PATHS.has(params.tab ?? "") ? `/admin/${params.tab}` : "/admin/engine"} />
                    )}
                  </Route>

                  <Route component={NotFound} />
                </Switch>
              </ErrorBoundary>
            </BroadcastShell>
          </OnboardingGuard>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ConvexProvider client={convex}>
        <ConvexAuthProvider client={convex}>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <AppRoutes />
              <Toaster />
            </TooltipProvider>
          </QueryClientProvider>
        </ConvexAuthProvider>
      </ConvexProvider>
    </ErrorBoundary>
  );
}

export default App;
