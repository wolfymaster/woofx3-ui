import { AlertCircle, CheckCircle2, CircleDashed, Loader2, type LucideIcon } from "lucide-react";
import type { Tone } from "@/lib/workflow-run-timeline";

/** How each tone is drawn: a status icon, its text colour, a tinted ground, and a solid bar. */
export const TONE_STYLE: Record<Tone, { icon: LucideIcon; color: string; bg: string; bar: string; spin: boolean }> = {
  running: { icon: Loader2, color: "text-blue-500", bg: "bg-blue-500/10", bar: "bg-blue-500", spin: true },
  success: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", bar: "bg-green-500", spin: false },
  failure: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10", bar: "bg-red-500", spin: false },
  neutral: {
    icon: CircleDashed,
    color: "text-muted-foreground",
    bg: "bg-muted",
    bar: "bg-muted-foreground/60",
    spin: false,
  },
};
