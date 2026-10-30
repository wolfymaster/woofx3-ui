import type { UserPageRefusal } from "@convex/lib/userPages";
import type { PageProblem } from "@shared/user-pages";
import { ConvexError } from "convex/values";
import { actionErrorMessage } from "@/lib/action-error";
import { NO_SLUG_MESSAGE, NOT_ENTITLED_MESSAGE } from "@/lib/user-page-publishing";

/**
 * What the screen does with a failed save, publish or unpublish. A refusal
 * the server explains (`UserPageRefusal`) gets its own treatment; anything
 * else is a plain error message.
 */
export type PageFailure =
  /** Problems to show against their fields. */
  | { kind: "problems"; message: string; problems: PageProblem[] }
  /** Someone else saved; the editor must reload before it can save or publish. */
  | { kind: "stale"; message: string }
  | { kind: "message"; message: string };

const REFUSAL_CODES: ReadonlySet<UserPageRefusal["code"]> = new Set([
  "invalid_content",
  "stale_draft",
  "no_slug",
  "not_entitled",
]);

/** The refusal a ConvexError carries, or null for any other error. */
export function userPageRefusalOf(error: unknown): UserPageRefusal | null {
  if (!(error instanceof ConvexError)) {
    return null;
  }
  const data: unknown = error.data;
  if (!data || typeof data !== "object" || !("code" in data) || typeof data.code !== "string") {
    return null;
  }
  if (!REFUSAL_CODES.has(data.code as UserPageRefusal["code"])) {
    return null;
  }
  const refusal = data as UserPageRefusal;
  if (refusal.code === "invalid_content" && !Array.isArray(refusal.problems)) {
    return null;
  }
  return refusal;
}

export function pageFailure(error: unknown): PageFailure {
  const refusal = userPageRefusalOf(error);
  if (refusal === null) {
    return { kind: "message", message: actionErrorMessage(error) };
  }
  switch (refusal.code) {
    case "invalid_content":
      return {
        kind: "problems",
        message: "The page has problems to fix first. They are marked below.",
        problems: refusal.problems,
      };
    case "stale_draft":
      return {
        kind: "stale",
        message: "Someone else saved this page since you opened it. Reload to see their changes.",
      };
    case "no_slug":
      return { kind: "message", message: NO_SLUG_MESSAGE };
    case "not_entitled":
      return { kind: "message", message: NOT_ENTITLED_MESSAGE };
  }
}
