import {
  type FormRefusalCode,
  hasUndeliverableText,
  isFormIdempotencyKey,
  MAX_FORM_ANSWERS,
  USER_PAGE_LIMITS,
} from "@shared/user-pages";
import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction } from "./_generated/server";
import { turnstileSecret, verifyTurnstile } from "./lib/turnstile";
import type { SubmissionAttempt } from "./lib/userPageFormSubmit";
import { checkEdgeGate } from "./lib/viewerEdgeGate";
import { logger } from "./logger";

// The form submit route. Pages post to the edge's
// `<user pages origin>/u/_/forms/submit`, which limits per client address and
// forwards the body here with the edge secret (lib/viewerEdgeGate.ts).

export const FORM_SUBMIT_PATH = "/api/user-page-forms/submit";

/** Must stay in the shape the edge passes on unchanged and client/src/user-page/widgets/form-submit.ts reads. */
const REFUSALS: Record<FormRefusalCode, { status: number; message: string }> = {
  unauthorized: { status: 401, message: "Forms are submitted from the page" },
  not_configured: { status: 503, message: "Form submissions are not configured" },
  invalid_request: { status: 400, message: "The request could not be read" },
  too_large: { status: 413, message: "The answers are too long to send" },
  page_unavailable: { status: 404, message: "This page is not available" },
  form_stale: { status: 409, message: "This form has changed; reload the page" },
  section_locked: { status: 403, message: "This form is not open to you" },
  session_expired: { status: 401, message: "The sign-in has ended" },
  invalid_answers: { status: 422, message: "Some answers need another look" },
  not_accepting: { status: 503, message: "This form is not accepting submissions right now" },
  verification_unconfigured: { status: 503, message: "Anonymous submissions are not available right now" },
  verification_failed: { status: 403, message: "The visitor check did not pass" },
  verification_unavailable: { status: 503, message: "The visitor check could not be done right now" },
  rate_limited: { status: 429, message: "Too many submissions; try again later" },
  internal: { status: 500, message: "The submission could not be saved" },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function refuse(code: FormRefusalCode): Response {
  const { status, message } = REFUSALS[code];
  return json(status, { error: { code, message } });
}

const ACCEPTED_BODY = { ok: true };

/** Whether a value from the body can safely be passed to a Convex function. */
function isCleanString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength && !hasUndeliverableText(value);
}

const MAX_SLUG_LENGTH = 128;
const MAX_TOKEN_LENGTH = 4096;

/**
 * The body as this route's types, or null when it is not one. Answers become
 * entries so their keys, which any client chooses, never become field names in
 * a Convex value.
 */
export function parseSubmitBody(raw: unknown): (SubmissionAttempt & { turnstileToken: string | null }) | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const body = raw as Record<string, unknown>;
  const { slug, widgetId, idempotencyKey, answers, sessionToken, turnstileToken } = body;
  if (
    !isCleanString(slug, MAX_SLUG_LENGTH) ||
    !isCleanString(widgetId, USER_PAGE_LIMITS.idLength) ||
    typeof idempotencyKey !== "string" ||
    !isFormIdempotencyKey(idempotencyKey) ||
    typeof answers !== "object" ||
    answers === null ||
    Array.isArray(answers)
  ) {
    return null;
  }
  if (sessionToken !== undefined && !isCleanString(sessionToken, MAX_TOKEN_LENGTH)) {
    return null;
  }
  if (turnstileToken !== undefined && !isCleanString(turnstileToken, MAX_TOKEN_LENGTH)) {
    return null;
  }
  const entries = Object.entries(answers);
  if (entries.length > MAX_FORM_ANSWERS) {
    return null;
  }
  const parsed: SubmissionAttempt["answers"] = [];
  for (const [id, value] of entries) {
    if (!isCleanString(id, USER_PAGE_LIMITS.idLength)) {
      return null;
    }
    if (typeof value !== "boolean" && !isCleanString(value, USER_PAGE_LIMITS.formSubmissionBytes)) {
      return null;
    }
    parsed.push({ id, value });
  }
  return {
    slug,
    widgetId,
    idempotencyKey,
    answers: parsed,
    sessionToken: sessionToken ?? null,
    turnstileToken: turnstileToken ?? null,
  };
}

async function decideSubmit(
  ctx: ActionCtx,
  { turnstileToken, ...attempt }: NonNullable<ReturnType<typeof parseSubmitBody>>
): Promise<Response> {
  const decided = await ctx.runQuery(internal.userPageForms.checkSubmission, attempt);
  if (decided.kind === "refused") {
    return refuse(decided.code);
  }
  if (decided.kind === "repeat") {
    return json(200, ACCEPTED_BODY);
  }
  let humanVerified = false;
  if (decided.viewer === null) {
    const secret = turnstileSecret(process.env);
    if (secret === null) {
      return refuse("verification_unconfigured");
    }
    const verdict = await verifyTurnstile(secret, turnstileToken);
    if (verdict === "refused") {
      return refuse("verification_failed");
    }
    if (verdict === "unavailable") {
      return refuse("verification_unavailable");
    }
    humanVerified = true;
  }
  const accepted = await ctx.runMutation(internal.userPageForms.acceptSubmission, { ...attempt, humanVerified });
  return accepted.kind === "refused" ? refuse(accepted.code) : json(200, ACCEPTED_BODY);
}

const submitHandler = httpAction(async (ctx, request) => {
  const gate = await checkEdgeGate(request.headers, process.env);
  if (!gate.ok) {
    if (gate.refusal === "not_configured") {
      logger.error("refusing form submit: the edge gate is not configured", { problem: gate.problem });
      return refuse("not_configured");
    }
    return refuse("unauthorized");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > USER_PAGE_LIMITS.formSubmissionBytes) {
    return refuse("too_large");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse("invalid_request");
  }
  const parsed = parseSubmitBody(raw);
  if (parsed === null) {
    return refuse("invalid_request");
  }
  try {
    return await decideSubmit(ctx, parsed);
  } catch (error: unknown) {
    logger.error("form submit failed", { error: String(error) });
    return refuse("internal");
  }
});

/** Adds the form submit route to the deployment's router. */
export function registerUserPageFormRoutes(http: HttpRouter): void {
  http.route({ path: FORM_SUBMIT_PATH, method: "POST", handler: submitHandler });
}
