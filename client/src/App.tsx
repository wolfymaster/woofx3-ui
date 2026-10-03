import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { AdminOnly } from "@/components/layout/admin-only";
import { BroadcastShell } from "@/components/layout/broadcast-shell";
import { OnboardingGuard } from "@/components/layout/onboarding-guard";
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
import { FEEDBACK_EDIT_ROUTE, FEEDBACK_NEW_PATH, FEEDBACK_PATH, FEEDBACK_POST_ROUTE } from "@/lib/feedback";
import { STREAM_RECAP_ROUTE, STREAM_RECAPS_PATH } from "@/lib/stream-recap-route";
import { WORKFLOW_RUN_ROUTE } from "@/lib/workflow-run-route";
import { convexClient as convex } from "./lib/convexClient";

const AdminAppearance = lazy(() => import("@/pages/admin/appearance"));
const AdminBackup = lazy(() => import("@/pages/admin/backup"));
const AdminEngine = lazy(() => import("@/pages/admin/engine"));
const AdminIntegrations = lazy(() => import("@/pages/admin/integrations"));
const AdminStorage = lazy(() => import("@/pages/admin/storage"));
const AlertEditor = lazy(() => import("@/pages/alert-editor"));
const AlertRun = lazy(() => import("@/pages/alert-run"));
const Alerts = lazy(() => import("@/pages/alerts"));
const Assets = lazy(() => import("@/pages/assets"));
const AcceptInvite = lazy(() => import("@/pages/auth/accept-invite"));
const Login = lazy(() => import("@/pages/auth/login"));
const Onboarding = lazy(() => import("@/pages/auth/onboarding"));
const Register = lazy(() => import("@/pages/auth/register"));
const TwitchCallback = lazy(() => import("@/pages/auth/twitch-callback"));
const CommandEditor = lazy(() => import("@/pages/command-editor"));
const CommandGroupEditor = lazy(() => import("@/pages/command-group-editor"));
const CommandStepAlertEditor = lazy(() => import("@/pages/command-step-alert-editor"));
const Commands = lazy(() => import("@/pages/commands"));
const CompanionPair = lazy(() => import("@/pages/companion-pair"));
const Counters = lazy(() => import("@/pages/counters"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Feedback = lazy(() => import("@/pages/feedback"));
const FeedbackNew = lazy(() => import("@/pages/feedback-new"));
const FeedbackPost = lazy(() => import("@/pages/feedback-post"));
const FeedbackEdit = lazy(() => import("@/pages/feedback-edit"));
const GoLive = lazy(() => import("@/pages/go-live"));
const Learning = lazy(() => import("@/pages/learning"));
const Logs = lazy(() => import("@/pages/logs"));
const ModuleInstall = lazy(() => import("@/pages/module-install"));
const Modules = lazy(() => import("@/pages/modules"));
const NotFound = lazy(() => import("@/pages/not-found"));
const Queues = lazy(() => import("@/pages/queues"));
const Scenes = lazy(() => import("@/pages/scenes"));
const Setup = lazy(() => import("@/pages/setup"));
const StarterPacks = lazy(() => import("@/pages/starter-packs"));
const StreamRecap = lazy(() => import("@/pages/stream-recap"));
const StreamRecaps = lazy(() => import("@/pages/stream-recaps"));
const Supporters = lazy(() => import("@/pages/supporters"));
const Team = lazy(() => import("@/pages/team"));
const TeamInvite = lazy(() => import("@/pages/team-invite"));
const Timers = lazy(() => import("@/pages/timers"));
const WorkflowRun = lazy(() => import("@/pages/workflow-run"));
const Workflows = lazy(() => import("@/pages/workflows"));

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

// Fills only the content area, so the shell stays mounted while a page chunk loads.
function PageLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// The error boundary sits outside the Suspense so a page chunk that fails to
// load (a stale deploy whose hashed chunk is gone) is caught here, not above the shell.
function PageBoundary({ resetKey, children }: { resetKey: string; children: React.ReactNode }) {
  return (
    <ErrorBoundary resetKey={resetKey}>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </ErrorBoundary>
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
      <Route path="/setup/:step?">
        <AuthGuard>
          <Setup />
        </AuthGuard>
      </Route>
      {/* Outside OnboardingGuard: pairing the companion comes before a local engine has an instance. */}
      <Route path="/companion/pair">
        <AuthGuard>
          <CompanionPair />
        </AuthGuard>
      </Route>

      {/* Protected app routes */}
      <Route>
        <AuthGuard>
          <BroadcastShell>
            <OnboardingGuard>
              <PageBoundary resetKey={location}>
                <Switch>
                  <Route path="/" component={Dashboard} />

                  {/* Stream section */}
                  <Route path="/stream">
                    <Redirect to="/stream/alerts" />
                  </Route>
                  <Route path="/stream/go-live" component={GoLive} />
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
                  <Route path={STREAM_RECAPS_PATH} component={StreamRecaps} />
                  <Route path={STREAM_RECAP_ROUTE} component={StreamRecap} />
                  <Route path="/stream/scenes" component={Scenes} />
                  <Route path="/stream/scenes/:id" component={Scenes} />
                  <Route path="/stream/supporters" component={Supporters} />
                  <Route path="/stream/assets" component={Assets} />
                  <Route path="/stream/starter-packs" component={StarterPacks} />
                  <Route path="/stream/workflows" component={Workflows} />
                  <Route path="/stream/workflows/new" component={Workflows} />
                  <Route path="/stream/workflows/:id" component={Workflows} />
                  <Route path="/stream/workflows/:id/edit" component={Workflows} />
                  <Route path={WORKFLOW_RUN_ROUTE} component={WorkflowRun} />

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
                  <Route path={FEEDBACK_PATH} component={Feedback} />
                  <Route path={FEEDBACK_NEW_PATH} component={FeedbackNew} />
                  <Route path={FEEDBACK_POST_ROUTE} component={FeedbackPost} />
                  <Route path={FEEDBACK_EDIT_ROUTE} component={FeedbackEdit} />

                  {/* Admin section */}
                  <Route path="/admin">
                    <Redirect to="/admin/engine" />
                  </Route>
                  <Route path="/admin/engine">
                    <AdminOnly>
                      <AdminEngine />
                    </AdminOnly>
                  </Route>
                  <Route path="/admin/integrations">
                    <AdminOnly>
                      <AdminIntegrations />
                    </AdminOnly>
                  </Route>
                  <Route path="/admin/storage">
                    <AdminOnly>
                      <AdminStorage />
                    </AdminOnly>
                  </Route>
                  <Route path="/admin/backup">
                    <AdminOnly>
                      <AdminBackup />
                    </AdminOnly>
                  </Route>
                  <Route path="/admin/appearance">
                    <AdminOnly>
                      <AdminAppearance />
                    </AdminOnly>
                  </Route>

                  <Route path="/team" component={Team} />
                  <Route path="/team/invite" component={TeamInvite} />

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
              </PageBoundary>
            </OnboardingGuard>
          </BroadcastShell>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      {/*
        Convex Auth claims any `?code=` in the address bar as its own OAuth
        code: it strips the parameter, tries to sign in with it, and signs the
        user out when that fails. No provider here uses that redirect, and the
        Twitch connect callback carries its own one-time `code`
        (pages/auth/twitch-callback.tsx), so the handling is off.
      */}
      <ConvexAuthProvider client={convex} shouldHandleCode={false}>
        <TooltipProvider>
          <Suspense fallback={<SplashScreen />}>
            <AppRoutes />
          </Suspense>
          <Toaster />
        </TooltipProvider>
      </ConvexAuthProvider>
    </ErrorBoundary>
  );
}

export default App;
