import type { LogRecordItem } from "@woofx3/api";

export interface ReconnectConfig {
  /** Wait after the first failure; it doubles with each further one. */
  reconnectBaseMs: number;
  reconnectMaxMs: number;
}

/** Wait before attempt number `attempt` (0 is the first retry): doubling, capped, then jittered down by up to half. */
export function reconnectDelay(attempt: number, config: ReconnectConfig, random: () => number): number {
  const ceiling = Math.min(config.reconnectMaxMs, config.reconnectBaseMs * 2 ** attempt);
  return ceiling * (0.5 + random() / 2);
}

/** A pushed frame as a record, or null when it is not one: the engine is a separate process and its frames are not trusted to match the type. */
export function parseLogRecord(data: string): LogRecordItem | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const text = ["cursor", "timestamp", "service", "level", "message"].every((key) => typeof record[key] === "string");
  return text ? (value as LogRecordItem) : null;
}
