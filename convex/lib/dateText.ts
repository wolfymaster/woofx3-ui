/** The zone every billing date is shown in. DST is handled by the IANA rules, so the label reads PST or PDT. */
export const DATE_TEXT_TIME_ZONE = "America/Los_Angeles";

/** A readable instant for emails and notices, such as "November 23, 2026 at 4:00 PM PST". The zone is part of the text because cutoffs are instants. */
export function dateText(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DATE_TEXT_TIME_ZONE,
    timeZoneName: "short",
  });
}
