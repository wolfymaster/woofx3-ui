/** A readable date for emails and notices, such as "November 23, 2026". Always UTC, so every reader sees the same day. */
export function dateText(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
