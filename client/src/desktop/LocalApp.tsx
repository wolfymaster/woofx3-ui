import { Loader2 } from "lucide-react";
import { Suspense, useEffect, useMemo } from "react";
import { Route, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocalEngineGatewayProvider } from "@/engine/boot/local";
import type { EngineTargetSource } from "@/lib/engine-session/target";
import type { LocalEngineSession } from "./host";
import { LocalShell } from "./LocalShell";
import { LOCAL_HOME_PATH, LOCAL_ROUTES } from "./local-routes";
import { useLocalEngineSession } from "./use-local-engine-session";

type ReadySession = Extract<LocalEngineSession, { kind: "ready" }>;

/** What the startup screen says while the engine is not ready. */
function startupMessage(session: LocalEngineSession | undefined): { title: string; detail?: string; busy: boolean } {
  switch (session?.kind) {
    case undefined:
    case "starting":
      return { title: "Starting woofx3…", busy: true };
    case "migrating":
      return { title: "Updating woofx3's data…", detail: "This can take a minute after an update.", busy: true };
    case "failed":
      return { title: "woofx3 is having trouble starting", detail: session.reason, busy: true };
    case "stopped":
      return { title: "woofx3 stopped", detail: session.reason, busy: false };
    case "notLocal":
      return { title: "woofx3 is not running on this computer", busy: false };
    case "ready":
      return { title: "", busy: false };
  }
}

function EngineStartup({ session }: { session: LocalEngineSession | undefined }) {
  const { title, detail, busy } = startupMessage(session);
  return (
    <div className="h-screen w-full flex items-center justify-center bg-background p-6">
      <div className="text-center max-w-md space-y-3" data-testid="local-engine-startup">
        {busy && <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />}
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="text-xs text-muted-foreground break-words">{detail}</p>}
      </div>
    </div>
  );
}

function PageLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Sends a path local mode does not serve to its home page. */
function ToLocalHome() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(LOCAL_HOME_PATH, { replace: true });
  }, [navigate]);
  return null;
}

/** The engine the host registered with, for the session's whole life: the host keeps one set of credentials per run. */
function readyTarget(session: ReadySession): EngineTargetSource {
  const target = { url: session.apiUrl, clientId: session.clientId, clientSecret: session.clientSecret };
  return {
    current: async () => target,
    onChange: () => () => {},
  };
}

function LocalPages({ session }: { session: ReadySession }) {
  const targets = useMemo(() => readyTarget(session), [session]);
  return (
    <LocalEngineGatewayProvider targets={targets}>
      <TooltipProvider>
        <LocalShell>
          <Suspense fallback={<PageLoading />}>
            <Switch>
              {LOCAL_ROUTES.map((route) => (
                <Route key={route.path} path={route.path} component={route.page} />
              ))}
              <Route component={ToLocalHome} />
            </Switch>
          </Suspense>
        </LocalShell>
        <Toaster />
      </TooltipProvider>
    </LocalEngineGatewayProvider>
  );
}

/**
 * The desktop app in local mode: the engine it runs on this computer, reached
 * directly, with no account. Waits for the host to have the engine ready and
 * registered, then shows the pages local mode serves.
 */
export default function LocalApp() {
  const session = useLocalEngineSession();
  return (
    <ErrorBoundary>
      {session?.kind === "ready" ? <LocalPages session={session} /> : <EngineStartup session={session} />}
    </ErrorBoundary>
  );
}
