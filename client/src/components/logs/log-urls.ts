import type { LogLevel } from "@woofx3/api";
import type { LogAccessGrant } from "@/engine/gateway";

export interface LogFilter {
  levels: LogLevel[];
  services: string[];
  text: string;
}

export const EMPTY_LOG_FILTER: LogFilter = { levels: [], services: [], text: "" };

/** `GET /logs/stream` for the live tail; the token rides in the query because an EventSource cannot set headers. */
export function logStreamUrl(grant: LogAccessGrant, filter: LogFilter, resumeAfter: string | null): string {
  const url = new URL("/logs/stream", grant.origin);
  url.searchParams.set("token", grant.token);
  if (resumeAfter !== null) {
    url.searchParams.set("lastEventId", resumeAfter);
  }
  if (filter.levels.length > 0) {
    url.searchParams.set("levels", filter.levels.join(","));
  }
  if (filter.services.length > 0) {
    url.searchParams.set("services", filter.services.join(","));
  }
  if (filter.text !== "") {
    url.searchParams.set("text", filter.text);
  }
  return url.toString();
}

/** `GET /logs/export`, a zip of every log file. */
export function logExportUrl(grant: LogAccessGrant): string {
  const url = new URL("/logs/export", grant.origin);
  url.searchParams.set("token", grant.token);
  return url.toString();
}
