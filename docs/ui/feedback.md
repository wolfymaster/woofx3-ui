# Feedback

`/help/feedback` is a voting board for ideas and bug reports. It is one list
for the whole product, not per account or instance: every signed-in user sees
every post, can post, vote and comment. All of it lives in Convex
(`convex/feedback.ts`); the engine is not involved.

| Route | Page |
|-------|------|
| `/help/feedback` | The board: sort by Top (votes) or New, filter by status, load more |
| `/help/feedback/new` | Post an idea or a bug |
| `/help/feedback/:postId` | One post with its comments |

## Data

| Table | Holds |
|-------|-------|
| `feedbackPosts` | Title, description, kind (`idea` or `bug`), status, author, and the `voteCount` and `commentCount` the board shows and sorts by |
| `feedbackVotes` | One row per post and user; the row is the vote |
| `feedbackComments` | Comments on a post, oldest first |

Convex has no count operator, so `voteCount` and `commentCount` are kept on
the post by the same mutation that adds or removes a vote or comment
(`toggleVote`, `addComment`). Posting counts the author's own vote.

Title, description and comment limits live in `convex/lib/feedback.ts` and are
enforced by the mutations; the forms use the same constants.

## Duplicates

While someone types a title on the New post page, `feedback.findSimilar`
searches existing titles (the `search_title` search index) and lists the
closest few, so they can vote on an existing post instead.

## Status

A post starts `open` and can move to `planned`, `in_progress`, `done` or
`declined`. Users cannot change status: the only writer is
`internal.feedback.setStatus`, meant for the internal backoffice through the
ops API (woofx3-ui#180). Until that exists, run it from the Convex dashboard
or `bunx convex run feedback:setStatus '{"postId": "...", "status": "planned"}'`.

Telling voters when a post they care about changes is tracked in
woofx3-ui#182.
