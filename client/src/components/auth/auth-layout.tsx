import type { ReactNode } from "react";
import { marketingUrl } from "@/lib/marketing-url";
import { cn } from "@/lib/utils";

const NAV: Array<{ path: string; label: string }> = [
  { path: "/features", label: "Features" },
  { path: "/marketplace", label: "Add-on marketplace" },
  { path: "/pricing", label: "Pricing" },
  { path: "/community", label: "Community" },
];

/** "woof" in coral and "x3" in white, as on the marketing site. */
function Wordmark() {
  return (
    <span className="text-xl font-bold tracking-tight">
      <span className="text-primary">woof</span>
      <span className="text-foreground">x3</span>
    </span>
  );
}

/**
 * The frame for the signed-out screens: the marketing site's header and background around a centred
 * form. `auth-brand` pins the marketing palette, so the person's chosen theme only shows from the dashboard on.
 */
export function AuthLayout({ children, width = "narrow" }: { children: ReactNode; width?: "narrow" | "wide" }) {
  const site = marketingUrl();
  return (
    <div className="auth-brand dark min-h-screen text-foreground flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-black/90 px-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[72px] max-w-7xl items-center gap-6">
          <a href={site} aria-label="woofx3 home" className="flex min-h-11 items-center">
            <Wordmark />
          </a>
          <nav aria-label="Primary" className="hidden items-center gap-0.5 text-[15px] lg:flex">
            {NAV.map((item) => (
              <a
                key={item.path}
                href={`${site}${item.path}`}
                className="rounded-md px-3 py-3 text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className={cn("w-full py-8", width === "wide" ? "max-w-4xl" : "max-w-md")}>{children}</div>
      </main>
    </div>
  );
}

/** The card the forms sit in, in the marketing site's surface style. */
export const AUTH_CARD_CLASS = "rounded-xl border-[#262636] bg-[#111119]";

/** A card on the marketing background, frosted so its glow shows through. */
export const AUTH_GLASS_CLASS = "rounded-xl border-white/10 bg-white/[0.04] backdrop-blur-xl";
