import type { RpcTarget } from "@woofx3/api/client";

/**
 * The engine's OBS connection state, from `getObsStatus()` (capability
 * `obs.status`). Declared here because the engine checkout this repo builds
 * against may predate it. Must match `ObsStatus` in woofx3
 * `shared/clients/typescript/api/api.ts` (wolfymaster/woofx3#193).
 *
 * - `unanswered`: the engine's scene manager did not reply, which says nothing
 *   about OBS itself.
 * - `failure`: `authentication` when OBS refused the password, `unreachable`
 *   when nothing answered at `address` or the connection was lost.
 * - `address`: the `host:port` last tried; never the password.
 */
export interface ObsStatus {
  state: "connecting" | "connected" | "retrying" | "stopped" | "unanswered";
  failure: "authentication" | "unreachable" | null;
  address: string | null;
}

export interface ObsStatusApi extends RpcTarget {
  getObsStatus(): Promise<unknown>;
}

const STATES: ReadonlySet<string> = new Set(["connecting", "connected", "retrying", "stopped", "unanswered"]);
const FAILURES: ReadonlySet<string> = new Set(["authentication", "unreachable"]);

export const UNANSWERED_OBS_STATUS: ObsStatus = { state: "unanswered", failure: null, address: null };

/**
 * The engine's answer as an ObsStatus. Anything unrecognised reads as
 * unanswered: a status that cannot be trusted must not look like a real one.
 */
export function parseObsStatus(raw: unknown): ObsStatus {
  const reply = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  if (typeof reply.state !== "string" || !STATES.has(reply.state)) {
    return UNANSWERED_OBS_STATUS;
  }
  return {
    state: reply.state as ObsStatus["state"],
    failure:
      typeof reply.failure === "string" && FAILURES.has(reply.failure) ? (reply.failure as ObsStatus["failure"]) : null,
    address: typeof reply.address === "string" && reply.address.length > 0 ? reply.address : null,
  };
}
