import type { EngineApi } from "./engineInstanceUrl";

/**
 * The engine's answers to the alert-queue controls, and a reading of each that
 * also accepts the shape an engine answered with before these existed.
 *
 * The result types must match AlertSkipResult, AlertClearResult and
 * AlertReplayResult in the engine's shared/clients/typescript/api/api.ts. They
 * are declared here because the checkout the `@woofx3/api` alias resolves to
 * may still describe the older answers (`boolean` for a replay,
 * `{ skipped: boolean }`, `{ cleared: number }`). Engines of both ages are
 * deployed, so the older answers are read too rather than taken for success.
 *
 * Free of Convex server imports so it can be tested directly.
 */

export interface AlertSkipResult {
  ok: boolean;
  /** Alerts that were playing and were ended; 0 means nothing was playing. */
  skipped: number;
  reason?: string;
}

export interface AlertClearResult {
  ok: boolean;
  /** Alerts that were waiting and were dropped. */
  cleared: number;
  reason?: string;
}

export interface AlertReplayResult {
  ok: boolean;
  replayEnvelopeId?: string;
  reason?: string;
}

/** Must match the alert-queue methods of `Woofx3EngineApi` (see above). */
export interface AlertQueueEngineApi extends Omit<EngineApi, "replayAlert" | "skipCurrentAlert" | "clearAlertQueue"> {
  replayAlert(id: string): Promise<AlertReplayResult | boolean>;
  skipCurrentAlert(): Promise<AlertSkipResult | { skipped: boolean }>;
  clearAlertQueue(): Promise<AlertClearResult | { cleared: number }>;
}

/** What an older engine's `false` from replayAlert meant. */
export const LEGACY_REPLAY_REFUSAL = "the engine no longer has this alert, or its stored payload cannot be read";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function optionalReason(value: Record<string, unknown>): string | undefined {
  return typeof value.reason === "string" && value.reason.length > 0 ? value.reason : undefined;
}

export function readSkipResult(raw: unknown): AlertSkipResult {
  if (isRecord(raw) && typeof raw.ok === "boolean") {
    if (!isCount(raw.skipped)) {
      throw new Error(`Engine answered skipCurrentAlert with an invalid count: ${String(raw.skipped)}`);
    }
    return { ok: raw.ok, skipped: raw.skipped, reason: optionalReason(raw) };
  }
  if (isRecord(raw) && typeof raw.skipped === "boolean") {
    return { ok: true, skipped: raw.skipped ? 1 : 0 };
  }
  throw new Error(`Engine answered skipCurrentAlert with an unexpected value: ${JSON.stringify(raw)}`);
}

export function readClearResult(raw: unknown): AlertClearResult {
  if (!isRecord(raw) || !isCount(raw.cleared)) {
    throw new Error(`Engine answered clearAlertQueue with an unexpected value: ${JSON.stringify(raw)}`);
  }
  if (typeof raw.ok === "boolean") {
    return { ok: raw.ok, cleared: raw.cleared, reason: optionalReason(raw) };
  }
  return { ok: true, cleared: raw.cleared };
}

export function readReplayResult(raw: unknown): AlertReplayResult {
  if (typeof raw === "boolean") {
    return raw ? { ok: true } : { ok: false, reason: LEGACY_REPLAY_REFUSAL };
  }
  if (isRecord(raw) && typeof raw.ok === "boolean") {
    const replayEnvelopeId = typeof raw.replayEnvelopeId === "string" ? raw.replayEnvelopeId : undefined;
    return { ok: raw.ok, replayEnvelopeId, reason: optionalReason(raw) };
  }
  throw new Error(`Engine answered replayAlert with an unexpected value: ${JSON.stringify(raw)}`);
}
