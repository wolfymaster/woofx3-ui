// Remote macro triggers: a secret URL that fires one macro from a Stream Deck,
// Bitfocus Companion, Touch Portal or a phone shortcut.
//
// The token in the URL is a bearer capability for exactly one macro. Only its
// SHA-256 hash is stored, so a leaked database row cannot be replayed; the
// token itself is shown once, when it is minted. Everything here is pure so
// the HTTP route, the dashboard action and the tests share one decision.

import type { ActionStep } from "@woofx3/api";
import { unescapeDollarKeys } from "./dollarKeys";
import {
  applyMacroVariables,
  extractMacroVariables,
  isMacroVariableName,
  type MacroActionStep,
  type MacroActionType,
  type MacroConfig,
} from "./macroVariables";

/**
 * The trigger endpoint. A token either follows it as one more path segment or
 * rides in an `Authorization: Bearer` header on the bare path.
 */
export const MACRO_TRIGGER_PATH = "/api/macros/trigger";
export const MACRO_TRIGGER_PATH_PREFIX = `${MACRO_TRIGGER_PATH}/`;

/**
 * Marks the string as a woofx3 macro token, so a token pasted somewhere it
 * should not be is recognizable to a person or a secret scanner.
 */
const TOKEN_PREFIX = "wfxm_";

/** 32 bytes is 256 bits of entropy, comfortably past the 128-bit floor for a guessable-by-nobody URL. */
const TOKEN_BYTES = 32;

/** base64url of 32 bytes without padding is always 43 characters. */
const TOKEN_PATTERN = /^wfxm_[A-Za-z0-9_-]{43}$/;

/** Largest request body the route reads. Variable values are short strings; anything bigger is a mistake. */
export const MAX_TRIGGER_BODY_BYTES = 8 * 1024;

/** Longest single variable value, so a chat command cannot be stuffed with a novel. */
export const MAX_VARIABLE_VALUE_LENGTH = 500;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A fresh trigger token. Must run where `crypto.getRandomValues` is a real
 * CSPRNG: a Convex action or the HTTP router, never a query or mutation, whose
 * randomness is seeded for determinism.
 */
export function generateTriggerToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}${toBase64Url(bytes)}`;
}

export function isWellFormedTriggerToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Lowercase hex SHA-256 of the token: the only form stored. A plain hash is
 * enough because the token carries 256 random bits; a slow KDF only helps
 * against low-entropy secrets such as passwords.
 */
export async function hashTriggerToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** The token in a trigger URL's path, or null for any path that is not exactly one well-formed token. */
export function parseMacroTriggerPath(pathname: string): string | null {
  if (!pathname.startsWith(MACRO_TRIGGER_PATH_PREFIX)) {
    return null;
  }
  const token = pathname.slice(MACRO_TRIGGER_PATH_PREFIX.length);
  return isWellFormedTriggerToken(token) ? token : null;
}

export function macroTriggerUrl(siteUrl: string, token: string): string {
  return `${macroTriggerEndpoint(siteUrl)}/${token}`;
}

/** The bare endpoint, for devices that send the token in a header. */
export function macroTriggerEndpoint(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${MACRO_TRIGGER_PATH}`;
}

/**
 * The token a request presents, from its `Authorization: Bearer` header or its
 * path, or null when it presents none, a malformed one, or two that disagree.
 * The header form keeps the secret out of the URL, which proxies, browser
 * history and request logs record.
 */
export function resolveTriggerToken(pathname: string, authorization: string | null): string | null {
  const bare = pathname === MACRO_TRIGGER_PATH || pathname === MACRO_TRIGGER_PATH_PREFIX;
  const pathToken = bare ? null : parseMacroTriggerPath(pathname);
  if (!bare && pathToken === null) {
    return null;
  }
  if (authorization === null) {
    return pathToken;
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  if (!match || !isWellFormedTriggerToken(match[1])) {
    return null;
  }
  if (pathToken !== null && pathToken !== match[1]) {
    return null;
  }
  return match[1];
}

/**
 * Whether the request came from a web page. Browsers attach `Origin` to every
 * cross-origin POST, and the devices this endpoint serves send none, so a
 * request carrying one is a page trying to fire the macro (a pasted URL in a
 * form, a malicious site replaying a leaked token) and is refused before the
 * token is looked at.
 */
export function isBrowserRequest(origin: string | null): boolean {
  return origin !== null && origin !== "";
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimit {
  /** Tokens added back per second. */
  perSecond: number;
  /** Most tokens the bucket holds: how many presses may land back to back. */
  burst: number;
}

/**
 * One press a second with room for five in a row. A person mashing a Stream
 * Deck key stays well inside it; a script looping on a leaked URL does not.
 */
export const MACRO_TRIGGER_RATE_LIMIT: RateLimit = { perSecond: 1, burst: 5 };

export interface RateBucket {
  tokens: number;
  refilledAt: number;
}

export type RateDecision =
  | { allowed: true; bucket: RateBucket }
  | { allowed: false; bucket: RateBucket; retryAfterMs: number };

/** A full bucket, for a trigger that has never been used. */
export function fullRateBucket(now: number, limit: RateLimit = MACRO_TRIGGER_RATE_LIMIT): RateBucket {
  return { tokens: limit.burst, refilledAt: now };
}

/**
 * Token bucket: refill for the time since the last call, then spend one token
 * if there is one. The caller persists the returned bucket either way, so a
 * refused call still records the refill it earned.
 */
export function takeRateToken(
  bucket: RateBucket,
  now: number,
  limit: RateLimit = MACRO_TRIGGER_RATE_LIMIT
): RateDecision {
  if (limit.perSecond <= 0 || limit.burst < 1) {
    throw new Error(`invalid rate limit: ${limit.perSecond}/s burst ${limit.burst}`);
  }
  // A clock that steps backwards earns nothing rather than draining the bucket.
  const elapsedMs = Math.max(0, now - bucket.refilledAt);
  const refilled = Math.min(limit.burst, bucket.tokens + (elapsedMs / 1000) * limit.perSecond);
  if (refilled >= 1) {
    return { allowed: true, bucket: { tokens: refilled - 1, refilledAt: now } };
  }
  const retryAfterMs = Math.ceil(((1 - refilled) / limit.perSecond) * 1000);
  return { allowed: false, bucket: { tokens: refilled, refilledAt: now }, retryAfterMs };
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

// A newline in a value would let one `{{var}}` smuggle a second line into a
// chat command, and the other control characters have no business in one.
export function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export type ParsedValues = { ok: true; values: Record<string, string> } | { ok: false; error: string };

function addValue(values: Record<string, string>, key: string, raw: unknown): string | null {
  // Keys that could never name a variable are ignored rather than refused:
  // Companion and Stream Deck plugins may add fields of their own.
  if (!isMacroVariableName(key)) {
    return null;
  }
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
    return `"${key}" must be a string, number or boolean`;
  }
  const value = String(raw);
  if (value.length > MAX_VARIABLE_VALUE_LENGTH) {
    return `"${key}" is longer than ${MAX_VARIABLE_VALUE_LENGTH} characters`;
  }
  if (hasControlCharacter(value)) {
    return `"${key}" contains a control character`;
  }
  values[key] = value;
  return null;
}

function addEntries(values: Record<string, string>, params: URLSearchParams): string | null {
  let firstError: string | null = null;
  params.forEach((raw, key) => {
    if (firstError === null) {
      firstError = addValue(values, key, raw);
    }
  });
  return firstError;
}

/**
 * Variable values from a trigger request: query parameters, then the body on
 * top (a JSON object, or a form-encoded body). A body value wins over a query
 * value of the same name.
 */
export function parseTriggerValues(input: {
  contentType: string | null;
  body: string;
  query: URLSearchParams;
}): ParsedValues {
  const values: Record<string, string> = {};
  const queryError = addEntries(values, input.query);
  if (queryError) {
    return { ok: false, error: queryError };
  }

  if (input.body.trim() === "") {
    return { ok: true, values };
  }

  const contentType = (input.contentType ?? "").toLowerCase();
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    const formError = addEntries(values, new URLSearchParams(input.body));
    return formError ? { ok: false, error: formError } : { ok: true, values };
  }

  // Anything else with a body is read as JSON: several device plugins send a
  // JSON body under text/plain or no content type at all.
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return { ok: false, error: "body is not valid JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "body must be a JSON object of variable values" };
  }
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const error = addValue(values, key, raw);
    if (error) {
      return { ok: false, error };
    }
  }
  return { ok: true, values };
}

// ---------------------------------------------------------------------------
// Planning a run
// ---------------------------------------------------------------------------

/** Shown to members, who may not run chat-command macros from the dashboard (see macros.run). */
export const CHAT_COMMAND_RUN_RESTRICTION = "Only owners and admins can run chat-command macros from the dashboard";

export type MacroRunPlan =
  | { kind: "trigger-workflow"; workflowNameOrId: string }
  | { kind: "chat-command"; commandName: string; text: string }
  // The step stays in its stored form (no `$` keys) because a plan crosses
  // Convex function boundaries; executeMacroPlan converts it for the engine.
  | { kind: "run-action"; step: MacroActionStep };

export type PlanResult = { ok: true; plan: MacroRunPlan } | { ok: false; status: 400 | 422; error: string };

/**
 * `!name rest of line` split into the command word and the text after it,
 * which is what the engine's executeCommand takes. Null for anything that is
 * not a `!command`: the engine has no way to post a plain chat message.
 */
export function parseChatCommand(command: string): { commandName: string; text: string } | null {
  const match = /^!(\S+)(?:\s+([\s\S]*))?$/.exec(command.trim());
  if (!match) {
    return null;
  }
  return { commandName: match[1], text: (match[2] ?? "").trim() };
}

/**
 * The command a chat-command macro runs. A button saved from the command
 * picker holds the bare word in `command` and its arguments in `commandText`;
 * an older button holds one typed `!word rest` line in `command`, which must
 * start with `!` so plain chat text is never run as a command.
 */
export function chatCommandFromConfig(config: MacroConfig): { commandName: string; text: string } | null {
  if (config.commandText === undefined) {
    return parseChatCommand(config.command ?? "");
  }
  const commandName = (config.command ?? "").trim().replace(/^!/, "");
  if (!/^\S+$/.test(commandName)) {
    return null;
  }
  return { commandName, text: config.commandText.trim() };
}

/**
 * Whether a macro of this type can have a trigger URL. HTTP-request macros are
 * fetched from the viewer's browser (see planMacroRun), and send-message
 * macros post through the signed-in user's Twitch link, which a trigger URL
 * does not carry.
 */
export function canTriggerRemotely(type: MacroActionType): boolean {
  return type === "chat-command" || type === "trigger-workflow" || type === "run-action";
}

/** The engine's ActionStep for a stored macro action, with its `$` keys restored. */
export function macroActionToEngineStep(stored: MacroActionStep): ActionStep {
  const step: ActionStep = {
    action: stored.action,
    parameters: unescapeDollarKeys(stored.parameters ?? {}) as Record<string, unknown>,
  };
  if (stored.function) {
    step.function = stored.function;
  }
  if (stored.ref) {
    step.$ref = stored.ref;
  }
  return step;
}

/**
 * The variables the macro needs that `values` does not supply. Blank counts
 * as missing: an empty `{{channel}}` would send a half-built command.
 */
export function missingMacroVariables(config: MacroConfig, values: Readonly<Record<string, string>>): string[] {
  return extractMacroVariables(config).filter((name) => (values[name] ?? "").trim() === "");
}

/**
 * What running this macro with these variable values asks the engine to do,
 * or why it cannot run. Shared by the dashboard's run action and the remote
 * trigger route, so a button press and a Stream Deck press do the same thing.
 *
 * HTTP-request macros are refused: they are fetched from the viewer's browser,
 * where a local target (OBS, a LAN device) is reachable. Running one from
 * Convex would reach a different network and make Convex a proxy that sends
 * the macro's stored headers to any URL.
 */
export function planMacroRun(
  type: MacroActionType,
  config: MacroConfig,
  values: Readonly<Record<string, string>>
): PlanResult {
  if (type === "http-request") {
    return {
      ok: false,
      status: 422,
      error:
        "HTTP request macros run in the browser and cannot be triggered remotely; point the device at that URL directly",
    };
  }
  if (type === "send-message") {
    return {
      ok: false,
      status: 422,
      error: "send message macros post from the dashboard and cannot be triggered remotely",
    };
  }

  const missing = missingMacroVariables(config, values);
  if (missing.length > 0) {
    return { ok: false, status: 400, error: `missing variables: ${missing.join(", ")}` };
  }
  const tainted = extractMacroVariables(config).filter((name) => hasControlCharacter(values[name] ?? ""));
  if (tainted.length > 0) {
    return { ok: false, status: 400, error: `control characters are not allowed in: ${tainted.join(", ")}` };
  }
  const resolved = applyMacroVariables(config, values);

  if (type === "trigger-workflow") {
    const workflowNameOrId = resolved.workflowId?.trim() ?? "";
    if (workflowNameOrId === "") {
      return { ok: false, status: 422, error: "this macro has no workflow selected" };
    }
    return { ok: true, plan: { kind: "trigger-workflow", workflowNameOrId } };
  }

  if (type === "run-action") {
    if (!resolved.actionStep || resolved.actionStep.action.trim() === "") {
      return { ok: false, status: 422, error: "this macro has no action selected" };
    }
    return { ok: true, plan: { kind: "run-action", step: resolved.actionStep } };
  }

  const parsed = chatCommandFromConfig(resolved);
  if (!parsed) {
    return { ok: false, status: 422, error: "this macro's command must start with ! followed by the command name" };
  }
  return { ok: true, plan: { kind: "chat-command", ...parsed } };
}

// ---------------------------------------------------------------------------
// Confirmed configuration
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * What a macro does, as a string that is equal for equal behavior whatever
 * the key order. A trigger stores the fingerprint an owner or admin approved;
 * a macro whose fingerprint has moved on does not run from its URL until one
 * of them approves again. Label, icon and color are left out: they change how
 * the button looks, not what it does.
 */
export function macroBehaviorFingerprint(type: MacroActionType, config: MacroConfig): string {
  return canonicalJson({ type, config });
}

// ---------------------------------------------------------------------------
// The route's decision
// ---------------------------------------------------------------------------

export type TriggerDecision =
  | { outcome: "not-found" }
  | { outcome: "method-not-allowed" }
  | { outcome: "rate-limited"; retryAfterMs: number; bucket: RateBucket }
  | { outcome: "refused"; status: number; error: string; bucket: RateBucket }
  | { outcome: "run"; plan: MacroRunPlan; bucket: RateBucket };

/**
 * What a trigger request gets, given the trigger its token matched (or null)
 * and that trigger's macro (or null when it is gone). A bucket in the result
 * must be persisted: a request that got as far as the rate limiter spent or
 * refilled it. The order matters: the method is checked before a rate token
 * is spent, so a device misconfigured for GET cannot drain the bucket for the
 * one that is set up right.
 */
export function decideTrigger(input: {
  trigger: {
    allowGet: boolean;
    bucket: RateBucket;
    /** The behavior an owner or admin approved when minting or re-confirming. */
    confirmedFingerprint: string;
    /** Whether whoever approved it still holds the owner or admin role. */
    confirmerIsManager: boolean;
  } | null;
  macro: { type: MacroActionType; config: MacroConfig } | null;
  method: "GET" | "POST";
  values: Readonly<Record<string, string>>;
  now: number;
}): TriggerDecision {
  const { trigger, macro } = input;
  if (!trigger || !macro) {
    return { outcome: "not-found" };
  }
  if (input.method === "GET" && !trigger.allowGet) {
    return { outcome: "method-not-allowed" };
  }
  const rate = takeRateToken(trigger.bucket, input.now);
  if (!rate.allowed) {
    return { outcome: "rate-limited", retryAfterMs: rate.retryAfterMs, bucket: rate.bucket };
  }
  if (macroBehaviorFingerprint(macro.type, macro.config) !== trigger.confirmedFingerprint) {
    return {
      outcome: "refused",
      status: 409,
      error: "the macro changed since this URL was issued; an owner or admin must re-confirm it",
      bucket: rate.bucket,
    };
  }
  if (!trigger.confirmerIsManager) {
    return {
      outcome: "refused",
      status: 409,
      error: "whoever approved this URL is no longer an owner or admin; an owner or admin must re-confirm it",
      bucket: rate.bucket,
    };
  }
  const planned = planMacroRun(macro.type, macro.config, input.values);
  if (!planned.ok) {
    return { outcome: "refused", status: planned.status, error: planned.error, bucket: rate.bucket };
  }
  return { outcome: "run", plan: planned.plan, bucket: rate.bucket };
}

export interface TriggerResponse {
  status: number;
  body: { ok: false; error: string };
  headers: Record<string, string>;
}

/**
 * The HTTP answer for a request that will not run. Unknown and malformed
 * tokens share one 404 so a caller cannot tell them apart.
 */
export function triggerRefusalResponse(
  refusal:
    | { outcome: "not-found" }
    | { outcome: "browser-origin" }
    | { outcome: "method-not-allowed" }
    | { outcome: "rate-limited"; retryAfterMs: number }
    | { outcome: "refused"; status: number; error: string }
): TriggerResponse {
  switch (refusal.outcome) {
    case "not-found": {
      return { status: 404, body: { ok: false, error: "not found" }, headers: {} };
    }
    case "browser-origin": {
      return {
        status: 403,
        body: { ok: false, error: "trigger URLs cannot be called from a web page" },
        headers: {},
      };
    }
    case "method-not-allowed": {
      return {
        status: 405,
        body: { ok: false, error: "this trigger accepts POST only; allow GET in the macro's remote trigger settings" },
        headers: { Allow: "POST" },
      };
    }
    case "rate-limited": {
      return {
        status: 429,
        body: { ok: false, error: "too many requests" },
        headers: { "Retry-After": String(Math.max(1, Math.ceil(refusal.retryAfterMs / 1000))) },
      };
    }
    case "refused": {
      return { status: refusal.status, body: { ok: false, error: refusal.error }, headers: {} };
    }
  }
}

// ---------------------------------------------------------------------------
// Engine errors
// ---------------------------------------------------------------------------

/** Longest engine reason passed back to a caller. */
const MAX_ENGINE_REASON_LENGTH = 200;

/**
 * Whether an error from an engine RPC means the call never got an answer, as
 * opposed to the engine answering with a refusal. capnweb revives an error the
 * engine threw as a plain Error carrying the engine's message, so the
 * transport's own failures are recognized by shape: a fetch that failed
 * (TypeError), a non-2xx batch response, or a reply capnweb could not parse.
 */
export function isEngineTransportFailure(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return true;
  }
  if (err instanceof TypeError) {
    return true;
  }
  return err.message.startsWith("RPC request failed:") || err.message.startsWith("bad RPC message");
}

/** The engine's refusal text, trimmed to something safe to hand a caller. */
export function engineRefusalReason(err: Error): string {
  const reason = err.message.trim();
  if (reason === "") {
    return "the engine refused the command";
  }
  return reason.length > MAX_ENGINE_REASON_LENGTH ? `${reason.slice(0, MAX_ENGINE_REASON_LENGTH)}...` : reason;
}
