import type { Ref } from "react";
import { cn } from "@/lib/utils";

interface EngineFrameProps {
  src: string;
  title: string;
  width: number;
  height: number;
  frameRef: Ref<HTMLIFrameElement>;
  onLoad: () => void;
  /** Extra Permissions-Policy features on top of local-network-access, e.g. "autoplay". */
  allowFeatures?: string;
  /** Positioning and visibility; the frame's embedding rules are not overridable from here. */
  className?: string;
  testId: string;
}

/**
 * An engine-served page framed behind an editor's canvas, which only talks to
 * it through postMessage. Every rule that makes the embedding work lives here
 * so a cookie or browser-policy change is fixed once; callers own the message
 * protocol and where the frame sits.
 */
export function EngineFrame({
  src,
  title,
  width,
  height,
  frameRef,
  onLoad,
  allowFeatures,
  className,
  testId,
}: EngineFrameProps) {
  return (
    // allow-same-origin alongside allow-scripts: the engine pages nest one frame per
    // widget and reach them through their own origin, which is the engine's, never
    // this page's. It grants no access to this page's origin.
    //
    // pointer-events-none: an iframe swallows pointer events once the cursor enters
    // it, so a press on the canvas would never reach the layers above. The page is a
    // preview surface and nothing in it is interactive.
    <iframe
      ref={frameRef}
      src={src}
      onLoad={onLoad}
      title={title}
      sandbox="allow-scripts allow-same-origin"
      // Chrome gates a public page reaching a private address behind the Local Network
      // Access permission, whose default allowlist is `self`; an engine hostname that
      // resolves to a LAN address (split-horizon DNS in dev) is otherwise auto-denied
      // with no prompt. Inert once the engine resolves publicly.
      allow={allowFeatures ? `local-network-access ${allowFeatures}` : "local-network-access"}
      scrolling="no"
      className={cn("pointer-events-none border-none bg-transparent", className)}
      // The engine pages declare no color-scheme, so they are light; a browser paints an
      // opaque backdrop behind a frame whose scheme differs from the iframe element's,
      // which under this app's dark theme would hide the canvas.
      style={{ width, height, colorScheme: "light" }}
      data-testid={testId}
    />
  );
}
