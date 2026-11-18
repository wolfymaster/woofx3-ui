import type { ConfirmOutcome } from "@convex/emailVerification";
import { ConvexError } from "convex/values";

/** What the verify form says for each refused code. */
export const CONFIRM_REFUSALS: Record<Exclude<ConfirmOutcome["status"], "verified">, string> = {
  invalid: "That code isn't right. Check it and try again.",
  expired: "That code has expired. Send a new one.",
  no_code: "There is no code waiting. Send a new one.",
  too_many_attempts: "Too many wrong codes. Send a new one.",
};

/** Whether an error from `invitations.accept` says the caller's email is not verified yet. */
export function isEmailUnverified(error: unknown): boolean {
  return error instanceof ConvexError && (error.data as { code?: unknown } | null)?.code === "email_unverified";
}
