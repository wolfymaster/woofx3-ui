import { normalizeEmail } from "../teamAccess";

export const MAX_REWARD_CENTS = 1_000_000;
const MAX_ACTOR_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;

export type ReferralCodeParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface IssueReferralCodeRequest {
  email: string;
  rewardCents: number;
  actor: string;
}

export interface UpdateReferralCodeRequest {
  rewardCents: number;
  actor: string;
}

export interface RevokeReferralCodeRequest {
  actor: string;
}

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function parseActor(raw: unknown): string | null {
  const actor = typeof raw === "string" ? raw.trim() : "";
  return actor !== "" && actor.length <= MAX_ACTOR_LENGTH ? actor : null;
}

function parseRewardCents(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw <= MAX_REWARD_CENTS ? raw : null;
}

const ACTOR_MESSAGE = `actor must be 1 to ${MAX_ACTOR_LENGTH} characters`;
const REWARD_MESSAGE = `rewardCents must be a positive integer of at most ${MAX_REWARD_CENTS}`;

export function parseIssueReferralCodeRequest(body: unknown): ReferralCodeParseResult<IssueReferralCodeRequest> {
  const raw = asObject(body);
  if (raw === null) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : "";
  if (!email.includes("@") || email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, message: "email must be an email address" };
  }
  const rewardCents = parseRewardCents(raw.rewardCents);
  if (rewardCents === null) {
    return { ok: false, message: REWARD_MESSAGE };
  }
  const actor = parseActor(raw.actor);
  if (actor === null) {
    return { ok: false, message: ACTOR_MESSAGE };
  }
  return { ok: true, value: { email, rewardCents, actor } };
}

export function parseUpdateReferralCodeRequest(body: unknown): ReferralCodeParseResult<UpdateReferralCodeRequest> {
  const raw = asObject(body);
  if (raw === null) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const rewardCents = parseRewardCents(raw.rewardCents);
  if (rewardCents === null) {
    return { ok: false, message: REWARD_MESSAGE };
  }
  const actor = parseActor(raw.actor);
  if (actor === null) {
    return { ok: false, message: ACTOR_MESSAGE };
  }
  return { ok: true, value: { rewardCents, actor } };
}

export function parseRevokeReferralCodeRequest(body: unknown): ReferralCodeParseResult<RevokeReferralCodeRequest> {
  const raw = asObject(body);
  if (raw === null) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const actor = parseActor(raw.actor);
  if (actor === null) {
    return { ok: false, message: ACTOR_MESSAGE };
  }
  return { ok: true, value: { actor } };
}
