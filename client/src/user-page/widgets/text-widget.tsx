import { lazy, Suspense } from "react";
import type { WidgetOf } from "./types";

/**
 * The Markdown renderer is most of the page's script, so it is its own chunk.
 * main.tsx starts loading it at boot, alongside the page's data, rather than
 * when the first text widget renders.
 */
const loadMarkdown = () => import("./markdown");
const PageMarkdown = lazy(loadMarkdown);

export function preloadMarkdown(): void {
  void loadMarkdown();
}

export function TextWidget({ widget }: { widget: WidgetOf<"text"> }) {
  return (
    <Suspense fallback={<TextPlaceholder />}>
      <PageMarkdown markdown={widget.config.markdown} />
    </Suspense>
  );
}

function TextPlaceholder() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden="true">
      <div className="h-4 w-11/12 rounded bg-line motion-safe:animate-pulse" />
      <div className="h-4 w-4/5 rounded bg-line motion-safe:animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-line motion-safe:animate-pulse" />
    </div>
  );
}
