/**
 * How long ago a timestamp was, short enough to sit in a list row.
 *
 * Empty string for anything unreadable, so a row with a missing or malformed
 * timestamp simply shows no time rather than "NaN ago".
 */
export function formatTimeAgo(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) {
    return "";
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}
