import { AlertCircle, BellRing, CheckCircle2, Loader2, type LucideIcon, SkipForward } from "lucide-react";

/**
 * How each point of an alert's lifecycle is named and drawn.
 *
 * Shared by the dashboard's feed and the Alert Log widget so a status never
 * looks like one thing in one place and something else in another. The keys
 * are the engine's own lifecycle values, mirrored in the `engineAlerts` table.
 */
export const ALERT_STATUS: Record<string, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  sent: { icon: Loader2, color: "text-blue-400", bg: "bg-blue-400/10", label: "Sent" },
  pending: { icon: Loader2, color: "text-blue-400", bg: "bg-blue-400/10", label: "Pending" },
  dispatched: { icon: Loader2, color: "text-blue-400", bg: "bg-blue-400/10", label: "Dispatched" },
  playing: { icon: BellRing, color: "text-blue-500", bg: "bg-blue-500/10", label: "Playing" },
  completed: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", label: "Played" },
  replayed: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", label: "Replayed" },
  failed: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10", label: "Failed" },
  timed_out: { icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-500/10", label: "Timed out" },
  skipped: { icon: SkipForward, color: "text-gray-500", bg: "bg-gray-500/10", label: "Skipped" },
};

/** The descriptor for a status, falling back to `sent` for one this build does not know. */
export function alertStatusStyle(status: string) {
  return ALERT_STATUS[status] ?? ALERT_STATUS.sent;
}

/**
 * Whether an alert ended badly.
 *
 * Must agree with `outcomeOf` in convex/engineAlerts.ts: the dashboard counts
 * failures there and filters for them here, and the two disagreeing would show
 * a tile saying three failures above a list holding two.
 */
export function isFailureStatus(status: string): boolean {
  return status === "failed" || status === "timed_out";
}

/** The fraction of settled alerts that played, or null when none have settled. */
export function successRate(totals: { completed: number; failed: number }): number | null {
  const settled = totals.completed + totals.failed;
  if (settled === 0) {
    return null;
  }
  return totals.completed / settled;
}
