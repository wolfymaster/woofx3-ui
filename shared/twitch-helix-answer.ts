import type { TwitchHelixResult } from "@woofx3/api";

// An engine Twitch method's result read as the Helix answer it stands for.
// Every answer Twitch gave becomes a `Response`, so the callers' status
// checks, parsers and error sentences read an engine answer exactly as they
// read Twitch's own. What is left is the engine having no answer from Twitch,
// which each caller handles in its own way.

/**
 * What an engine Twitch method's result says.
 *
 * - `answer`: Twitch answered, with this status and body.
 * - `unconfirmed`: the engine sent the call but cannot say what Twitch did
 *   with it; a write may have been applied.
 * - `refused`: the engine never called Twitch.
 */
export type HelixAnswer =
  | { kind: "answer"; response: Response }
  | { kind: "unconfirmed"; reason: UnconfirmedReason; error: string }
  | { kind: "refused"; code: "invalid_arguments" | "not_linked" | "unavailable"; error: string };

export type UnconfirmedReason = "timeout" | "failed";

/**
 * The status a write reports when Twitch may or may not have applied it.
 * Every caller already turns a Twitch 5xx into its failure sentence.
 */
export const UNCONFIRMED_WRITE_STATUS: Record<UnconfirmedReason, number> = { failed: 502, timeout: 504 };

const UNCONFIRMED_HEADER = "X-Woofx3-Unconfirmed";

/** The answer a caller reads for a call the engine could not confirm. */
export function unconfirmedResponse(reason: UnconfirmedReason): Response {
  return new Response(null, { status: UNCONFIRMED_WRITE_STATUS[reason], headers: { [UNCONFIRMED_HEADER]: reason } });
}

/**
 * Whether a failed write's response stands for an engine that could not say
 * whether Twitch applied it, rather than for Twitch's own refusal. A caller
 * that answers a refusal with a different write (pins re-post the message)
 * must not do so here, or a write Twitch applied would be followed by a
 * second one.
 */
export function isUnconfirmedWrite(response: Response): boolean {
  return response.headers.has(UNCONFIRMED_HEADER);
}

/** `result` as an answer. It crossed an RPC boundary, so its shape is checked rather than trusted. */
export function readHelixResult(result: unknown): HelixAnswer {
  if (!isHelixResult(result)) {
    return {
      kind: "unconfirmed",
      reason: "failed",
      error: `unreadable answer ${JSON.stringify(result) ?? String(result)}`,
    };
  }
  if (result.ok) {
    return { kind: "answer", response: okResponse(result.body) };
  }
  switch (result.code) {
    case "helix":
      return {
        kind: "answer",
        response: new Response(result.body === "" ? null : result.body, { status: result.status }),
      };
    case "timeout":
    case "failed":
      return { kind: "unconfirmed", reason: result.code, error: result.error };
    case "invalid_arguments":
    case "not_linked":
    case "unavailable":
      return { kind: "refused", code: result.code, error: result.error };
  }
}

function okResponse(body: unknown): Response {
  if (body === null || body === undefined) {
    return new Response(null, { status: 204 });
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function isHelixResult(value: unknown): value is TwitchHelixResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as { ok?: unknown; code?: unknown; status?: unknown; body?: unknown };
  if (result.ok === true) {
    return true;
  }
  if (result.ok !== false || typeof result.code !== "string") {
    return false;
  }
  if (result.code !== "helix") {
    return true;
  }
  // A Response refuses a status outside 200-599, and an error result below 400 would be a 2xx read as a failure.
  return (
    typeof result.status === "number" &&
    Number.isInteger(result.status) &&
    result.status >= 400 &&
    result.status <= 599 &&
    typeof result.body === "string"
  );
}
