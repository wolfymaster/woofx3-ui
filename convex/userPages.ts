import { getAuthUserId } from "@convex-dev/auth/server";
import { checkPageContent, defaultPageContent, type PageContent, pageContentValidator } from "@shared/user-pages";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";
import { getInstanceMembership } from "./lib/teamAccess";
import {
  bindingProblems,
  instanceAllowsUserPages,
  pageSlugForInstance,
  requireRevision,
  userPageForInstance,
  userPageRefusal,
} from "./lib/userPages";

// The owner's side of a user page. Any member may edit the draft; publishing
// puts the instance's name on a public page, so it takes an admin, and it
// alone is gated by plan (instanceAllowsUserPages).

export interface UserPageForEditing {
  /** The name the page is published under, or null when the instance has none (it is not a managed engine). */
  slug: string | null;
  /** Whether the plan lets this instance have a live page. */
  canPublish: boolean;
  draft: { revision: number; content: PageContent; savedAt: number | null };
  published: { revision: number; publishedAt: number } | null;
}

/** The page as its editor shows it, with a default draft before the first save. Null for a non-member. */
export const forEditing = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<UserPageForEditing | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return null;
    }
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      return null;
    }
    const slug = await pageSlugForInstance(ctx, instanceId);
    const canPublish = await instanceAllowsUserPages(ctx, instance);
    const page = await userPageForInstance(ctx, instanceId);
    if (!page) {
      return {
        slug,
        canPublish,
        draft: { revision: 0, content: defaultPageContent(), savedAt: null },
        published: null,
      };
    }
    const draft = await requireRevision(ctx, page.draftRevisionId);
    const published = page.publishedRevisionId ? await requireRevision(ctx, page.publishedRevisionId) : null;
    return {
      slug,
      canPublish,
      draft: { revision: draft.revision, content: draft.content, savedAt: draft.savedAt },
      published:
        published && page.publishedAt !== undefined
          ? { revision: published.revision, publishedAt: page.publishedAt }
          : null,
    };
  },
});

/** Refuses content with any problem, its shape aside (the argument validator has already checked that). */
async function requireValidContent(ctx: MutationCtx, instanceId: Id<"instances">, content: PageContent) {
  const checkedContent = checkPageContent(content);
  const problems = checkedContent.ok ? [] : checkedContent.problems;
  problems.push(...(await bindingProblems(ctx, instanceId, content)));
  if (problems.length > 0) {
    throw userPageRefusal({ code: "invalid_content", message: "The page has problems to fix first", problems });
  }
}

/**
 * Saves the draft. `baseRevision` is the draft revision the editor started
 * from (0 before the first save), so two members editing at once cannot
 * silently overwrite each other: the second save is refused and reloads.
 * Never touches the published copy.
 */
export const saveDraft = mutation({
  args: { instanceId: v.id("instances"), baseRevision: v.number(), content: pageContentValidator },
  handler: async (ctx, { instanceId, baseRevision, content }): Promise<{ revision: number }> => {
    const userId = await requireInstanceRole(ctx, instanceId);
    const page = await userPageForInstance(ctx, instanceId);
    const draft = page ? await requireRevision(ctx, page.draftRevisionId) : null;
    if ((draft?.revision ?? 0) !== baseRevision) {
      throw userPageRefusal({
        code: "stale_draft",
        message: "Someone else saved this page since you opened it; reload to see their changes",
      });
    }
    await requireValidContent(ctx, instanceId, content);

    const now = Date.now();
    const revision = baseRevision + 1;
    const fields = { instanceId, revision, content, savedBy: userId, savedAt: now };
    if (page && draft) {
      await ctx.db.replace(draft._id, fields);
      await ctx.db.patch(page._id, { updatedAt: now });
    } else {
      const draftRevisionId = await ctx.db.insert("userPageRevisions", fields);
      await ctx.db.insert("userPages", { instanceId, draftRevisionId, createdAt: now, updatedAt: now });
    }
    return { revision };
  },
});

async function requirePage(ctx: MutationCtx, instanceId: Id<"instances">): Promise<Doc<"userPages">> {
  const page = await userPageForInstance(ctx, instanceId);
  if (!page) {
    throw new Error("This instance has no page yet; save one first");
  }
  return page;
}

/**
 * Publishes the draft at `revision`, the one the owner is looking at, so
 * nothing saved since then goes live unseen. The draft is copied into a new
 * revision and the page switched to it in this one transaction; visitors see
 * either the old page or the new one, never a mix. Content is checked again,
 * since a resource it binds may have been deleted since the save.
 */
export const publish = mutation({
  args: { instanceId: v.id("instances"), revision: v.number() },
  handler: async (ctx, { instanceId, revision }): Promise<{ publishedAt: number }> => {
    const userId = await requireInstanceRole(ctx, instanceId, "admin");
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      throw new Error("Instance not found");
    }
    if (!(await instanceAllowsUserPages(ctx, instance))) {
      throw userPageRefusal({
        code: "not_entitled",
        message: "Your plan does not include a public page for this engine",
      });
    }
    if ((await pageSlugForInstance(ctx, instanceId)) === null) {
      throw userPageRefusal({ code: "no_slug", message: "Pages can be published from managed engines only" });
    }
    const page = await requirePage(ctx, instanceId);
    const draft = await requireRevision(ctx, page.draftRevisionId);
    if (draft.revision !== revision) {
      throw userPageRefusal({
        code: "stale_draft",
        message: "The draft changed since you opened it; reload and check it before publishing",
      });
    }
    const previous = page.publishedRevisionId ? await requireRevision(ctx, page.publishedRevisionId) : null;
    if (previous?.revision === draft.revision && page.publishedAt !== undefined) {
      return { publishedAt: page.publishedAt };
    }
    await requireValidContent(ctx, instanceId, draft.content);

    const now = Date.now();
    const publishedRevisionId = await ctx.db.insert("userPageRevisions", {
      instanceId,
      revision: draft.revision,
      content: draft.content,
      savedBy: userId,
      savedAt: now,
    });
    await ctx.db.patch(page._id, { publishedRevisionId, publishedAt: now, updatedAt: now });
    if (previous) {
      await ctx.db.delete(previous._id);
    }
    return { publishedAt: now };
  },
});

/** Takes the page offline. The draft stays, so publishing again brings it back as it was last edited. */
export const unpublish = mutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<null> => {
    await requireInstanceRole(ctx, instanceId, "admin");
    const page = await requirePage(ctx, instanceId);
    if (!page.publishedRevisionId) {
      return null;
    }
    await ctx.db.patch(page._id, { publishedRevisionId: undefined, publishedAt: undefined, updatedAt: Date.now() });
    await ctx.db.delete(page.publishedRevisionId);
    return null;
  },
});
