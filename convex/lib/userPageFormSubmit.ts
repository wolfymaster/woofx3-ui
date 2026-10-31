import {
  checkFormAnswers,
  type FormAnswers,
  type FormField,
  type FormRefusalCode,
  USER_PAGE_LIMITS,
} from "@shared/user-pages";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { sectionsForViewer } from "./publicPage";
import type { PageViewer } from "./sectionAccess";
import { turnstileSecret } from "./turnstile";
import { submissionQueueFor, viewerRoleNames } from "./userPageSubmissions";
import { instanceAllowsUserPages, instanceForPageSlug, requireRevision, userPageForInstance } from "./userPages";
import { pageViewerFor, viewerFromSession } from "./viewerSessionAuth";

/** One submit as the route read it. Answers stay entries here because Convex records refuse some key names. */
export interface SubmissionAttempt {
  slug: string;
  formId: string;
  idempotencyKey: string;
  answers: { id: string; value: string | boolean }[];
  sessionToken: string | null;
}

/** A submission that passed every check, with what its row is built from. */
export interface FreshSubmission {
  kind: "fresh";
  instanceId: Id<"instances">;
  pageId: Id<"userPages">;
  viewer: Doc<"pageSubmissions">["viewer"];
  formTitle: string | undefined;
  fields: Doc<"pageSubmissions">["fields"];
}

export type SubmissionEvaluation = { kind: "refused"; code: FormRefusalCode } | { kind: "repeat" } | FreshSubmission;

function refused(code: FormRefusalCode): SubmissionEvaluation {
  return { kind: "refused", code };
}

/** The form a published page holds under `formId`, and the section that holds it. */
function findForm(content: Doc<"userPageRevisions">["content"], formId: string, viewer: PageViewer) {
  for (const { section, access } of sectionsForViewer(content, viewer)) {
    for (const widget of section.widgets) {
      if (widget.id === formId && widget.type === "form") {
        return { config: widget.config, access };
      }
    }
  }
  return null;
}

function snapshotFields(fields: readonly FormField[], answers: FormAnswers): FreshSubmission["fields"] {
  return fields.map((field) => ({ id: field.id, label: field.label, type: field.type, value: answers[field.id] }));
}

/**
 * Decides a submit against the published page and the verified session. The
 * route runs this as a query, so a refusal costs no Turnstile token, and the
 * mutation runs it again in the transaction that writes the row, so nothing
 * can change between the check and the write. Identity comes only from the
 * session; nothing in the body can name a viewer.
 *
 * A repeat is answered before anything else: its first attempt was accepted,
 * and it gets the same answer even if the form has changed since.
 */
export async function evaluateSubmission(ctx: QueryCtx, attempt: SubmissionAttempt): Promise<SubmissionEvaluation> {
  const held = await instanceForPageSlug(ctx, attempt.slug);
  if (!held) {
    return refused("page_unavailable");
  }
  const { instanceId } = held;
  const page = await userPageForInstance(ctx, instanceId);
  if (!page) {
    return refused("page_unavailable");
  }
  const repeat = await ctx.db
    .query("pageSubmissions")
    .withIndex("by_page_and_form_and_idempotency_key", (q) =>
      q.eq("pageId", page._id).eq("formId", attempt.formId).eq("idempotencyKey", attempt.idempotencyKey)
    )
    .first();
  if (repeat) {
    return { kind: "repeat" };
  }
  const instance = await ctx.db.get(instanceId);
  if (!instance || !page.publishedRevisionId || !(await instanceAllowsUserPages(ctx, instance))) {
    return refused("page_unavailable");
  }

  const signedIn = await viewerFromSession(ctx, attempt.sessionToken);
  if (attempt.sessionToken !== null && !signedIn) {
    return refused("session_expired");
  }
  const pageViewer = await pageViewerFor(ctx, instanceId, signedIn);
  const { content } = await requireRevision(ctx, page.publishedRevisionId);
  const form = findForm(content, attempt.formId, pageViewer);
  if (!form) {
    return refused("form_stale");
  }
  if (form.access.kind === "locked") {
    return refused("section_locked");
  }
  const answers: FormAnswers = Object.fromEntries(attempt.answers.map((answer) => [answer.id, answer.value]));
  const checked = checkFormAnswers(form.config.fields, answers);
  if (checked.kind === "stale") {
    return refused("form_stale");
  }
  if (checked.kind === "invalid") {
    return refused("invalid_answers");
  }

  const queue = await submissionQueueFor(ctx, instanceId);
  if ((queue?.pendingCount ?? 0) >= USER_PAGE_LIMITS.pendingSubmissionsPerPage) {
    return refused("not_accepting");
  }
  if (!signedIn && turnstileSecret(process.env) === null) {
    return refused("verification_unconfigured");
  }
  return {
    kind: "fresh",
    instanceId,
    pageId: page._id,
    viewer: signedIn
      ? {
          platform: signedIn.platform,
          platformUserId: signedIn.platformUserId,
          displayName: signedIn.displayName,
          roles: viewerRoleNames(pageViewer),
        }
      : null,
    formTitle: form.config.title,
    fields: snapshotFields(form.config.fields, answers),
  };
}
