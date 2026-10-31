import { type FormAnswers, type FormRefusalCode, isFormRefusalCode, USER_PAGE_LIMITS } from "@shared/user-pages";

export interface FormSubmitRequest {
  slug: string;
  widgetId: string;
  /** Kept across resends of the same answers, so a lost response cannot queue them twice. */
  idempotencyKey: string;
  answers: FormAnswers;
  sessionToken?: string;
  turnstileToken?: string;
}

export type FormSubmitFailure = FormRefusalCode | "network";
export type FormSubmitResult = { ok: true } | { ok: false; failure: FormSubmitFailure };

/** How long the page waits for the edge before telling the visitor it can't tell what happened. */
export const FORM_SUBMIT_TIMEOUT_MS = 20_000;

/** The edge's submit route, which limits per address and forwards to Convex (convex/userPageFormsHttp.ts). */
export function formSubmitUrl(origin: string, pageBase: string): string {
  return new URL(`${pageBase}_/forms/submit`, origin).toString();
}

/** The failure a response names; the edge's own limit and outage answers may use codes Convex doesn't. */
function failureOf(status: number, body: unknown): FormSubmitFailure {
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 413) {
    return "too_large";
  }
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return isFormRefusalCode(code) ? code : "internal";
}

export async function postFormSubmission(
  url: string,
  request: FormSubmitRequest,
  send: typeof fetch
): Promise<FormSubmitResult> {
  const payload = JSON.stringify(request);
  if (new TextEncoder().encode(payload).byteLength > USER_PAGE_LIMITS.formSubmissionBytes) {
    return { ok: false, failure: "too_large" };
  }
  let response: Response;
  try {
    response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(FORM_SUBMIT_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, failure: "network" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && (body as { ok?: unknown } | null)?.ok === true) {
    return { ok: true };
  }
  return { ok: false, failure: failureOf(response.status, body) };
}

export const FORM_NOT_ACCEPTING_MESSAGE = "This form isn't accepting answers right now.";

export interface FormFailureCopy {
  message: string;
  /** What the visitor can do beyond sending again. */
  action: "reload" | "sign_in" | null;
}

const TRY_AGAIN: FormFailureCopy = {
  message: "We couldn't send your answers. They're still here, so you can try again.",
  action: null,
};

/** What each way a submit can fail tells the visitor. */
export function formFailureCopy(failure: FormSubmitFailure): FormFailureCopy {
  switch (failure) {
    case "form_stale":
    case "page_unavailable":
      return {
        message: "This form has changed since you opened the page. Reload the page to see the latest version.",
        action: "reload",
      };
    case "section_locked":
      return { message: "This form isn't open to your account right now.", action: "reload" };
    case "session_expired":
      return { message: "You've been signed out. Sign in again, then send your answers.", action: "sign_in" };
    case "invalid_answers":
      return { message: "Some of your answers need another look.", action: null };
    case "not_accepting":
    case "verification_unconfigured":
    case "not_configured":
      return { message: FORM_NOT_ACCEPTING_MESSAGE, action: null };
    case "verification_failed":
      return { message: "We couldn't confirm you're a person. Complete the check again, then send.", action: null };
    case "rate_limited":
      return {
        message: "That's a lot of answers in a short time. Give it a little while and try again.",
        action: null,
      };
    case "too_large":
      return { message: "Your answers are too long to send together. Try shortening them.", action: null };
    case "verification_unavailable":
    case "network":
    case "invalid_request":
    case "unauthorized":
    case "internal":
      return TRY_AGAIN;
  }
}
