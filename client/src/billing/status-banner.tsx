import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** How a status banner reads: a warning (amber), a failure (destructive), or plain information. */
export type StatusTone = "warning" | "danger" | "info";

const TONES: Record<StatusTone, { box: string; icon: string }> = {
  warning: { box: "border-amber-500/30 bg-amber-500/10", icon: "text-amber-500" },
  danger: { box: "border-destructive/30 bg-destructive/10", icon: "text-destructive" },
  info: { box: "border-border bg-muted/50", icon: "text-muted-foreground" },
};

interface StatusBannerProps {
  tone: StatusTone;
  children: ReactNode;
  /** An optional control below the message, e.g. a link to fix the problem. */
  action?: ReactNode;
}

/** One status line, shared by the organization's subscription and a sponsorship's own state. */
export function StatusBanner({ tone, children, action }: StatusBannerProps) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  const { box, icon } = TONES[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-md border p-3 text-sm", box)}>
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", icon)} />
      <div className="space-y-2">
        <p>{children}</p>
        {action}
      </div>
    </div>
  );
}
