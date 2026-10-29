import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { type HostModeView, hostMode } from "./host";
import { ModeChooser } from "./ModeChooser";

// Each mode is its own chunk, so local mode never loads the hosted app or
// creates its Convex client, and the hosted app never loads the direct
// gateway.
const HostedApp = lazy(() => import("@/App"));
const LocalApp = lazy(() => import("./LocalApp"));

type ModeRead = { status: "reading" } | { status: "read"; view: HostModeView } | { status: "failed"; message: string };

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-screen w-full flex items-center justify-center bg-background p-6">{children}</div>;
}

const LOADING = (
  <Centered>
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </Centered>
);

/**
 * The desktop app's root: asks the host which mode this run is in, then shows
 * the chooser (no mode chosen yet), the hosted app (signed in to an account)
 * or the local app (the engine on this computer).
 */
export default function DesktopApp() {
  const [mode, setMode] = useState<ModeRead>({ status: "reading" });
  useEffect(() => {
    hostMode().then(
      (view) => setMode({ status: "read", view }),
      (reason: unknown) =>
        setMode({ status: "failed", message: reason instanceof Error ? reason.message : String(reason) })
    );
  }, []);

  if (mode.status === "reading") {
    return LOADING;
  }
  if (mode.status === "failed") {
    return (
      <Centered>
        <p className="text-sm text-destructive max-w-md text-center" role="alert">
          woofx3 could not tell how it is set up to run: {mode.message}
        </p>
      </Centered>
    );
  }
  if (!mode.view.chosen) {
    return <ModeChooser />;
  }
  return <Suspense fallback={LOADING}>{mode.view.mode === "local" ? <LocalApp /> : <HostedApp />}</Suspense>;
}
