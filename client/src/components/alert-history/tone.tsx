import { AlertCircle, CheckCircle2, CircleDashed, Loader2, type LucideIcon } from "lucide-react";
import type { Tone } from "@/lib/workflow-run-timeline";

/** How each tone is drawn. Shared by the run list and the timeline so a status never looks different in two places. */
export const TONE_STYLE: Record<Tone, { icon: LucideIcon; color: string; bg: string; spin: boolean }> = {
  running: { icon: Loader2, color: "text-blue-500", bg: "bg-blue-500/10", spin: true },
  success: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", spin: false },
  failure: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10", spin: false },
  neutral: { icon: CircleDashed, color: "text-muted-foreground", bg: "bg-muted", spin: false },
};
