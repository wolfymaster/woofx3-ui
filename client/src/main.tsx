import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { IS_DESKTOP } from "@/lib/desktop";
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
createRoot(container).render(
  <Suspense fallback={null}>
    <Root />
  </Suspense>
);
