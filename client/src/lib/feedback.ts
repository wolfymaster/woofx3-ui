import type { FeedbackKind, FeedbackStatus } from "@convex/lib/feedback";
import { ConvexError } from "convex/values";

export const FEEDBACK_PATH = "/help/feedback";
export const FEEDBACK_NEW_PATH = `${FEEDBACK_PATH}/new`;
export const FEEDBACK_POST_ROUTE = `${FEEDBACK_PATH}/:postId`;
export const FEEDBACK_EDIT_ROUTE = `${FEEDBACK_POST_ROUTE}/edit`;

export function feedbackPostPath(postId: string): string {
  return `${FEEDBACK_PATH}/${encodeURIComponent(postId)}`;
}

export function feedbackEditPath(postId: string): string {
  return `${feedbackPostPath(postId)}/edit`;
}

// Must list every value of feedbackStatusValidator in convex/lib/feedback.ts.
export const FEEDBACK_STATUSES: Record<FeedbackStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-muted text-muted-foreground" },
  planned: { label: "Planned", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  in_progress: { label: "In progress", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  done: { label: "Done", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  declined: { label: "Declined", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
};

export const FEEDBACK_STATUS_ORDER: FeedbackStatus[] = ["open", "planned", "in_progress", "done", "declined"];

// Must list every value of feedbackKindValidator in convex/lib/feedback.ts.
export const FEEDBACK_KINDS: Record<FeedbackKind, { label: string; description: string }> = {
  idea: { label: "Idea", description: "Something new, or a better way to do something" },
  bug: { label: "Bug", description: "Something that doesn't work the way it should" },
};

/** The message a Feedback mutation refused with, or a generic one for anything unexpected. */
export function feedbackErrorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return "Something went wrong. Try again.";
}
