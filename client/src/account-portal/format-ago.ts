const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function formatAgo(ms: number, now: number): string {
  const age = Math.max(0, now - ms);
  if (age < MINUTE_MS) {
    return "just now";
  }
  const [count, unit] =
    age < HOUR_MS
      ? [Math.floor(age / MINUTE_MS), "minute"]
      : age < DAY_MS
        ? [Math.floor(age / HOUR_MS), "hour"]
        : [Math.floor(age / DAY_MS), "day"];
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}
