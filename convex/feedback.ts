import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type QueryCtx, query } from "./_generated/server";
import {
  type FeedbackKind,
  type FeedbackStatus,
  feedbackKindValidator,
  feedbackStatusValidator,
  normalizeFeedbackBody,
  normalizeFeedbackComment,
  normalizeFeedbackTitle,
} from "./lib/feedback";

// The Feedback board: one product-wide list of ideas and bug reports that every
// signed-in user can read, post to, vote on and comment on. Nothing here is
// scoped to an instance or account.

/** Comments shown on one post. A thread longer than this shows its first comments only. */
const COMMENT_LIMIT = 200;
const SIMILAR_LIMIT = 5;

export type FeedbackAuthor = { name: string; image: string | null };

export type FeedbackPostView = {
  _id: Id<"feedbackPosts">;
  _creationTime: number;
  kind: FeedbackKind;
  title: string;
  body: string;
  status: FeedbackStatus;
  voteCount: number;
  commentCount: number;
  author: FeedbackAuthor;
  hasVoted: boolean;
  isAuthor: boolean;
};

export type FeedbackCommentView = {
  _id: Id<"feedbackComments">;
  _creationTime: number;
  body: string;
  author: FeedbackAuthor;
  isAuthor: boolean;
};

async function requireUserId(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("Sign in to use Feedback");
  }
  return userId;
}

/** Looks up each author once per call; a board page often repeats the same few people. */
function authorLoader(ctx: QueryCtx) {
  const cache = new Map<Id<"users">, Promise<FeedbackAuthor>>();
  return (userId: Id<"users">): Promise<FeedbackAuthor> => {
    let author = cache.get(userId);
    if (!author) {
      author = ctx.db.get(userId).then((user) => ({
        name: user?.name ?? "Former user",
        image: user?.image ?? null,
      }));
      cache.set(userId, author);
    }
    return author;
  };
}

async function hasVoted(ctx: QueryCtx, postId: Id<"feedbackPosts">, userId: Id<"users">): Promise<boolean> {
  const vote = await ctx.db
    .query("feedbackVotes")
    .withIndex("by_post_and_user", (q) => q.eq("postId", postId).eq("userId", userId))
    .unique();
  return vote !== null;
}

async function toPostView(
  ctx: QueryCtx,
  post: Doc<"feedbackPosts">,
  userId: Id<"users">,
  loadAuthor: ReturnType<typeof authorLoader>
): Promise<FeedbackPostView> {
  const [author, voted] = await Promise.all([loadAuthor(post.authorId), hasVoted(ctx, post._id, userId)]);
  return {
    _id: post._id,
    _creationTime: post._creationTime,
    kind: post.kind,
    title: post.title,
    body: post.body,
    status: post.status,
    voteCount: post.voteCount,
    commentCount: post.commentCount,
    author,
    hasVoted: voted,
    isAuthor: post.authorId === userId,
  };
}

/**
 * Posts in board order, optionally one status only. "new" is creation order,
 * which the by_status index and the bare table both end in; ties in "top" also
 * fall to the newest, since every index ends in _creationTime.
 */
function orderedPosts(ctx: QueryCtx, sort: "top" | "new", status: FeedbackStatus | undefined) {
  const posts = ctx.db.query("feedbackPosts");
  if (sort === "top") {
    const byVotes =
      status === undefined
        ? posts.withIndex("by_vote_count")
        : posts.withIndex("by_status_and_vote_count", (q) => q.eq("status", status));
    return byVotes.order("desc");
  }
  const byAge = status === undefined ? posts : posts.withIndex("by_status", (q) => q.eq("status", status));
  return byAge.order("desc");
}

export const list = query({
  args: {
    sort: v.union(v.literal("top"), v.literal("new")),
    status: v.optional(feedbackStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const result = await orderedPosts(ctx, args.sort, args.status).paginate(args.paginationOpts);
    const loadAuthor = authorLoader(ctx);
    const page = await Promise.all(result.page.map((post) => toPostView(ctx, post, userId, loadAuthor)));
    return { ...result, page };
  },
});

/** Takes the id as written in the URL, so a mangled link reads as "not found" rather than failing validation. */
export const get = query({
  args: { postId: v.string() },
  handler: async (ctx, args): Promise<FeedbackPostView | null> => {
    const userId = await requireUserId(ctx);
    const postId = ctx.db.normalizeId("feedbackPosts", args.postId);
    const post = postId ? await ctx.db.get(postId) : null;
    if (!post) {
      return null;
    }
    return await toPostView(ctx, post, userId, authorLoader(ctx));
  },
});

export const listComments = query({
  args: { postId: v.id("feedbackPosts") },
  handler: async (ctx, args): Promise<FeedbackCommentView[]> => {
    const userId = await requireUserId(ctx);
    const comments = await ctx.db
      .query("feedbackComments")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .take(COMMENT_LIMIT);
    const loadAuthor = authorLoader(ctx);
    return await Promise.all(
      comments.map(async (comment) => ({
        _id: comment._id,
        _creationTime: comment._creationTime,
        body: comment.body,
        author: await loadAuthor(comment.authorId),
        isAuthor: comment.authorId === userId,
      }))
    );
  },
});

/** Existing posts whose titles match what someone is typing, so they can vote instead of posting a duplicate. */
export const findSimilar = query({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const text = args.title.trim();
    if (text.length < 3) {
      return [];
    }
    const matches = await ctx.db
      .query("feedbackPosts")
      .withSearchIndex("search_title", (q) => q.search("title", text))
      .take(SIMILAR_LIMIT);
    return matches.map((post) => ({
      _id: post._id,
      title: post.title,
      status: post.status,
      voteCount: post.voteCount,
    }));
  },
});

/** Posts a new idea or bug report. The author's own vote is counted, as on most voting boards. */
export const create = mutation({
  args: { kind: feedbackKindValidator, title: v.string(), body: v.string() },
  handler: async (ctx, args): Promise<Id<"feedbackPosts">> => {
    const userId = await requireUserId(ctx);
    const postId = await ctx.db.insert("feedbackPosts", {
      authorId: userId,
      kind: args.kind,
      title: normalizeFeedbackTitle(args.title),
      body: normalizeFeedbackBody(args.body),
      status: "open",
      voteCount: 1,
      commentCount: 0,
    });
    await ctx.db.insert("feedbackVotes", { postId, userId });
    return postId;
  },
});

export const toggleVote = mutation({
  args: { postId: v.id("feedbackPosts") },
  handler: async (ctx, args): Promise<{ voted: boolean }> => {
    const userId = await requireUserId(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new ConvexError("This post no longer exists");
    }
    const existing = await ctx.db
      .query("feedbackVotes")
      .withIndex("by_post_and_user", (q) => q.eq("postId", args.postId).eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.patch(post._id, { voteCount: Math.max(0, post.voteCount - 1) });
      return { voted: false };
    }
    await ctx.db.insert("feedbackVotes", { postId: post._id, userId });
    await ctx.db.patch(post._id, { voteCount: post.voteCount + 1 });
    return { voted: true };
  },
});

export const addComment = mutation({
  args: { postId: v.id("feedbackPosts"), body: v.string() },
  handler: async (ctx, args): Promise<Id<"feedbackComments">> => {
    const userId = await requireUserId(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new ConvexError("This post no longer exists");
    }
    const commentId = await ctx.db.insert("feedbackComments", {
      postId: post._id,
      authorId: userId,
      body: normalizeFeedbackComment(args.body),
    });
    await ctx.db.patch(post._id, { commentCount: post.commentCount + 1 });
    return commentId;
  },
});

/** Moves a post through triage. Internal: operators set status from outside the dashboard. */
export const setStatus = internalMutation({
  args: { postId: v.id("feedbackPosts"), status: feedbackStatusValidator },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new ConvexError("No such feedback post");
    }
    if (post.status === args.status) {
      return;
    }
    await ctx.db.patch(post._id, { status: args.status, statusChangedAt: Date.now() });
  },
});
