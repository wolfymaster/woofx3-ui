import type { PageAccent } from "@shared/user-pages";
import type { ReactNode } from "react";
import { accentStyle } from "./theme";

const WOOFX3_HOME = "https://woofx3.tv";

/**
 * The frame every user page view sits in, found or not: the accent's colour
 * tokens, the width, and the footer. `actions` sits at the top right, over
 * the header.
 */
export function PageShell({
  accent,
  actions,
  children,
}: {
  accent: PageAccent;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={accentStyle(accent)} className="relative mx-auto flex min-h-screen max-w-5xl flex-col">
      {actions !== undefined && <div className="absolute right-4 top-4 z-10 sm:right-6">{actions}</div>}
      <div className="flex-1">{children}</div>
      <footer className="px-4 py-10 text-center text-sm text-muted sm:px-6">
        Made with{" "}
        <a
          href={WOOFX3_HOME}
          className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4"
        >
          woofx3
        </a>
      </footer>
    </div>
  );
}
