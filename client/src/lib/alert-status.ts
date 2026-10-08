import { isEngineAlertStatus, outcomeOf } from "@convex/lib/engineAlertLifecycle";
import { AlertCircle, BellRing, CheckCircle2, HelpCircle, Loader2, type LucideIcon, SkipForward } from "lucide-react";

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
  unknown: { icon: HelpCircle, color: "text-gray-500", bg: "bg-gray-500/10", label: "Unknown" },
};

/** The descriptor for a status, falling back to `sent` for one this build does not know. */
export function alertStatusStyle(status: string) {
  return ALERT_STATUS[status] ?? ALERT_STATUS.sent;
}

const UNCONFIRMED_STYLE = {
  icon: HelpCircle,
  color: "text-gray-500",
  bg: "bg-gray-500/10",
  label: "Unconfirmed",
};

/**
 * The descriptor for one alert, which differs from its status's when the alert
 * never settled: a row the overview counts as unconfirmed must not keep
 * spinning in the feed as though it were still on its way.
 *
 * `progressedAt` is the alert's `lastProgressAt`, and `now` a ticking clock
 * (`useMinuteClock`) so the row turns unconfirmed while it is on screen.
 */
export function engineAlertStyle(status: string, progressedAt: number, now: number) {
  const style = alertStatusStyle(status);
  if (!isEngineAlertStatus(status)) {
    return style;
  }
  return outcomeOf(status, progressedAt, now) === "unconfirmed" ? UNCONFIRMED_STYLE : style;
}

/** The fraction of settled alerts that played, or null when none have settled. */
export function successRate(totals: { completed: number; failed: number }): number | null {
  const settled = totals.completed + totals.failed;
  if (settled === 0) {
    return null;
  }
  return totals.completed / settled;
}

/**
 * What in a window of alerts has not settled, or null when everything has.
 * In-flight and unconfirmed alerts are both named when both exist: one playing
 * alert must not hide a dozen the engine lost track of.
 */
export function unsettledDetail(totals: { inFlight: number; unconfirmed: number }): string | null {
  const parts: string[] = [];
  if (totals.inFlight > 0) {
    parts.push(`${totals.inFlight} in flight`);
  }
  if (totals.unconfirmed > 0) {
    parts.push(`${totals.unconfirmed} never confirmed`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
