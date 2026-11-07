import type { ParseResult } from "../notifications";
import { PLAN_TIERS, type PlanTier } from "../organization";
import type { DiscountSpec } from "../payments/provider";

// Bodies of the ops API's billing writes, as the backoffice sends them.
// Shape and range checks happen here, before anything is written; whether the
// org's state allows the write is decided where it is applied.

function object(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function onlyKeys(raw: Record<string, unknown>, allowed: readonly string[]): string | null {
  const extra = Object.keys(raw).find((key) => !allowed.includes(key));
  return extra === undefined ? null : `Unknown field "${extra}"; expected ${allowed.join(", ")}`;
}

function planTier(value: unknown): PlanTier | null {
  return PLAN_TIERS.find((tier) => tier === value) ?? null;
}

const fail = (message: string) => ({ ok: false as const, message });

/** `{ plan }` */
export function parsePlanRequest(body: unknown): ParseResult<{ plan: PlanTier }> {
  const raw = object(body);
  if (raw === null) {
    return fail("body must be a JSON object");
  }
  const extra = onlyKeys(raw, ["plan"]);
  const plan = planTier(raw.plan);
  if (extra !== null) {
    return fail(extra);
  }
  return plan === null ? fail(`plan must be one of ${PLAN_TIERS.join(", ")}`) : { ok: true, value: { plan } };
}

export type ExemptionRequest = { kind: "grant"; plan: PlanTier; until: number | null } | { kind: "revoke" };

/** `{ plan, until? }` grants or changes an exemption, `until` in epoch ms; `{ revoke: true }` ends it. */
export function parseExemptionRequest(body: unknown): ParseResult<ExemptionRequest> {
  const raw = object(body);
  if (raw === null) {
    return fail("body must be a JSON object");
  }
  if (raw.revoke !== undefined) {
    const extra = onlyKeys(raw, ["revoke"]);
    if (extra !== null || raw.revoke !== true) {
      return fail(extra ?? "revoke must be true");
    }
    return { ok: true, value: { kind: "revoke" } };
  }
  const extra = onlyKeys(raw, ["plan", "until"]);
  if (extra !== null) {
    return fail(extra);
  }
  const plan = planTier(raw.plan);
  if (plan === null) {
    return fail(`plan must be one of ${PLAN_TIERS.join(", ")}`);
  }
  const until = raw.until ?? null;
  if (until !== null && !(typeof until === "number" && Number.isSafeInteger(until) && until > 0)) {
    return fail("until must be a time in epoch milliseconds, or left out for no end");
  }
  return { ok: true, value: { kind: "grant", plan, until } };
}

/** `{ reason }`: what the operator suspended the org for, kept in the audit log. */
export function parseSuspendRequest(body: unknown): ParseResult<{ reason: string }> {
  const raw = object(body);
  if (raw === null) {
    return fail("body must be a JSON object");
  }
  const extra = onlyKeys(raw, ["reason"]);
  if (extra !== null) {
    return fail(extra);
  }
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  return reason === "" ? fail("reason must be a non-empty string") : { ok: true, value: { reason } };
}

const DISCOUNT_KEY = /^[a-z0-9_-]{1,40}$/;

function discountDuration(value: unknown): DiscountSpec["duration"] | null {
  const raw = object(value);
  switch (raw?.kind) {
    case "once":
      return { kind: "once" };
    case "forever":
      return { kind: "forever" };
    case "months":
      return typeof raw.months === "number" && Number.isInteger(raw.months) && raw.months >= 1
        ? { kind: "months", months: raw.months }
        : null;
    default:
      return null;
  }
}

function discountSpec(value: unknown): DiscountSpec | null {
  const raw = object(value);
  const duration = discountDuration(raw?.duration);
  if (raw === null || duration === null) {
    return null;
  }
  if (raw.kind === "percent_off") {
    const percent = raw.percent;
    return typeof percent === "number" && percent > 0 && percent <= 100
      ? { kind: "percent_off", percent, duration }
      : null;
  }
  if (raw.kind === "amount_off") {
    const amountCents = raw.amountCents;
    return typeof amountCents === "number" && Number.isInteger(amountCents) && amountCents > 0 && raw.currency === "usd"
      ? { kind: "amount_off", amountCents, currency: "usd", duration }
      : null;
  }
  return null;
}

/** `{ key, spec }`: `key` names the discount (the provider's coupon id derives from it). */
export function parseDiscountRequest(body: unknown): ParseResult<{ key: string; spec: DiscountSpec }> {
  const raw = object(body);
  if (raw === null) {
    return fail("body must be a JSON object");
  }
  const extra = onlyKeys(raw, ["key", "spec"]);
  if (extra !== null) {
    return fail(extra);
  }
  if (typeof raw.key !== "string" || !DISCOUNT_KEY.test(raw.key)) {
    return fail("key must be 1-40 lowercase letters, digits, dashes or underscores");
  }
  const spec = discountSpec(raw.spec);
  if (spec === null) {
    return fail(
      "spec must be { kind: percent_off, percent (0-100] } or { kind: amount_off, amountCents, currency: usd }, with duration once, forever or { kind: months, months >= 1 }"
    );
  }
  return { ok: true, value: { key: raw.key, spec } };
}
