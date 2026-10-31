import { USER_PAGE_LIMITS } from "./limits";
import type { FormField } from "./widgets";

/**
 * What a visitor's answers must be for a form to take them. The page checks
 * them before sending and Convex checks them again against the published form,
 * with this one set of rules.
 */

export type FormAnswerValue = string | boolean;
export type FormAnswers = Record<string, FormAnswerValue>;

export interface FormFieldProblem {
  fieldId: string;
  message: string;
}

/**
 * - `stale`: these answers were written for other questions than the form now
 *   has; only reloading the page can help.
 * - `invalid`: the questions match, and the visitor can fix what they wrote.
 */
export type FormAnswersCheck = { kind: "ok" } | { kind: "stale" } | { kind: "invalid"; problems: FormFieldProblem[] };

// In unicode mode this matches only surrogates that are not part of a pair.
const LONE_SURROGATES = /[\uD800-\uDFFF]/gu;

/**
 * Whether `text` holds a character the engine's database cannot store: NUL or a
 * lone surrogate. The engine refuses a delivery carrying one for good, so
 * nothing with one may be queued.
 */
export function hasUndeliverableText(text: string): boolean {
  return text.includes("\0") || text.search(LONE_SURROGATES) !== -1;
}

/**
 * `text` as it can be delivered: without those characters and within `maxLength`,
 * for text the visitor did not write and so cannot be asked to fix.
 */
export function deliverableText(text: string, maxLength: number): string {
  const clean = (value: string) => value.replaceAll("\0", "").replace(LONE_SURROGATES, "");
  // Cleaned again because the cut can land inside a surrogate pair.
  return clean(clean(text).slice(0, maxLength));
}

/** A form's answers before anything is filled in: one entry per question, as a submit always carries. */
export function emptyFormAnswers(fields: readonly FormField[]): FormAnswers {
  return Object.fromEntries(fields.map((field) => [field.id, field.type === "checkbox" ? false : ""]));
}

function fieldProblem(field: FormField, value: FormAnswerValue): "stale" | string | null {
  switch (field.type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") {
        return "stale";
      }
      if (field.required && value.trim() === "") {
        return "This one is required";
      }
      if (value.length > field.maxLength) {
        return `Keep this to ${field.maxLength} characters`;
      }
      return hasUndeliverableText(value) ? "This has a character that can't be sent" : null;
    }
    case "select": {
      if (typeof value !== "string") {
        return "stale";
      }
      if (value === "") {
        return field.required ? "Choose one" : null;
      }
      if (!field.options.some((option) => option.value === value)) {
        return "stale";
      }
      return hasUndeliverableText(value) ? "This choice can't be sent; let the streamer know" : null;
    }
    case "checkbox": {
      if (typeof value !== "boolean") {
        return "stale";
      }
      return field.required && !value ? "This one is required" : null;
    }
  }
}

/**
 * Holds `answers` to `fields`. A submit carries an entry for every question,
 * empty when unanswered, so any difference in the set of ids means the form
 * changed after the page loaded.
 */
export function checkFormAnswers(fields: readonly FormField[], answers: FormAnswers): FormAnswersCheck {
  const answered = new Set(Object.keys(answers));
  if (answered.size !== fields.length || fields.some((field) => !answered.has(field.id))) {
    return { kind: "stale" };
  }
  const problems: FormFieldProblem[] = [];
  for (const field of fields) {
    const problem = fieldProblem(field, answers[field.id]);
    if (problem === "stale") {
      return { kind: "stale" };
    }
    if (problem !== null) {
      problems.push({ fieldId: field.id, message: problem });
    }
  }
  return problems.length === 0 ? { kind: "ok" } : { kind: "invalid", problems };
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

/** The shape of the key a page mints per submit attempt. */
export function isFormIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY.test(value);
}

/** Why a submit was refused, as the `code` of the error envelope the submit route answers with. */
export const FORM_REFUSAL_CODES = [
  "unauthorized",
  "not_configured",
  "invalid_request",
  "too_large",
  "page_unavailable",
  "form_stale",
  "section_locked",
  "session_expired",
  "invalid_answers",
  "not_accepting",
  "verification_unconfigured",
  "verification_failed",
  "verification_unavailable",
  "rate_limited",
  "internal",
] as const;

export type FormRefusalCode = (typeof FORM_REFUSAL_CODES)[number];

export function isFormRefusalCode(code: unknown): code is FormRefusalCode {
  return (FORM_REFUSAL_CODES as readonly unknown[]).includes(code);
}

/** The most answers any request can carry: one per question of the largest form. */
export const MAX_FORM_ANSWERS = USER_PAGE_LIMITS.formFields;
