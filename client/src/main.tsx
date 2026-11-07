import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { appLogger } from "@/lib/app-logger";
import { IS_DESKTOP } from "@/lib/desktop";
import { LoggerProvider } from "@/lib/logger-context";
import { startThemeSync } from "@/lib/theme/sync";
import "./index.css";

// The desktop build starts at its mode choice; the web build is the hosted
// app alone. IS_DESKTOP is a build constant, so each build carries only its
// own root.
const Root = IS_DESKTOP ? lazy(() => import("./desktop/DesktopApp")) : lazy(() => import("./App"));

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element to render the app into");
}

startThemeSync();
if (IS_DESKTOP) {
  import("./desktop/external-links").then(
    ({ installDesktopExternalLinks }) => installDesktopExternalLinks(appLogger),
    (error: unknown) => appLogger.error("Couldn't set up opening links in the browser", { error })
  );
}
createRoot(container).render(
  <LoggerProvider logger={appLogger}>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </LoggerProvider>
);
