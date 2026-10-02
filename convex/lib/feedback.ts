import { ConvexError, type Infer, v } from "convex/values";

// The Feedback board's rules, kept free of ctx so they can be tested directly.
// Must match FEEDBACK_STATUSES and FEEDBACK_KINDS in client/src/lib/feedback.ts,
// which give each value its label.

export const feedbackStatusValidator = v.union(
  v.literal("open"),
  v.literal("planned"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("declined")
);
export type FeedbackStatus = Infer<typeof feedbackStatusValidator>;

export const feedbackKindValidator = v.union(v.literal("idea"), v.literal("bug"));
export type FeedbackKind = Infer<typeof feedbackKindValidator>;

export const FEEDBACK_TITLE_MIN = 4;
export const FEEDBACK_TITLE_MAX = 120;
export const FEEDBACK_BODY_MAX = 5_000;
export const FEEDBACK_COMMENT_MAX = 2_000;

/** Trims and collapses runs of whitespace, so "  Dark   mode " and "Dark mode" read as the same title. */
export function normalizeFeedbackTitle(raw: string): string {
  const title = raw.trim().replace(/\s+/g, " ");
  if (title.length < FEEDBACK_TITLE_MIN) {
    throw new ConvexError(`Titles need at least ${FEEDBACK_TITLE_MIN} characters`);
  }
  if (title.length > FEEDBACK_TITLE_MAX) {
    throw new ConvexError(`Titles are limited to ${FEEDBACK_TITLE_MAX} characters`);
  }
  return title;
}

/** Trims surrounding whitespace only; line breaks inside a description are the author's formatting. */
export function normalizeFeedbackBody(raw: string): string {
  const body = raw.trim();
  if (body.length > FEEDBACK_BODY_MAX) {
    throw new ConvexError(`Descriptions are limited to ${FEEDBACK_BODY_MAX} characters`);
  }
  return body;
}

export function normalizeFeedbackComment(raw: string): string {
  const body = raw.trim();
  if (body.length === 0) {
    throw new ConvexError("A comment cannot be empty");
  }
  if (body.length > FEEDBACK_COMMENT_MAX) {
    throw new ConvexError(`Comments are limited to ${FEEDBACK_COMMENT_MAX} characters`);
  }
  return body;
}

/** Why a post or comment was refused for coming too fast, and when the next one will be accepted. */
export function feedbackRateLimitMessage(action: "post" | "comment", retryAfterMs: number): string {
  const minutes = Math.ceil(retryAfterMs / 60_000);
  const wait = minutes <= 1 ? "a minute" : `${minutes} minutes`;
  const noun = action === "post" ? "posts" : "comments";
  return `You've added a lot of ${noun} recently. Try again in ${wait}.`;
}
