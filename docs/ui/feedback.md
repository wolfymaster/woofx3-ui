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
| `/help/feedback/:postId/edit` | Edit your own post while it is open |

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

## Editing and deleting

The author can edit or delete a post while its status is `open`
(`authorCanChangeFeedbackPost` in `convex/lib/feedback.ts`). Once operators
move it on, it is fixed: voters backed what it said, and the roadmap points at
it. The post page shows Edit and Delete only when the query reports
`canChange`, and `update` and `remove` check the same rule.

An edit that changes anything sets `editedAt`, shown as "edited" next to the
date. Delete removes the post in its own transaction, so it leaves the board
at once. Its votes and comments are then removed by
`internal.feedback.deletePostChildren`, which deletes up to 200 of each per
transaction and schedules itself again until none are left.

## Rate limits

Posting and commenting are limited per user with `@convex-dev/rate-limiter`
token buckets, defined at the top of `convex/feedback.ts`:

| Action | Burst | Refill |
|--------|-------|--------|
| Post | 3 | 5 per hour |
| Comment | 10 | 30 per hour |

A refused request fails with a message saying how long to wait
(`feedbackRateLimitMessage`), which the forms show as a toast. Input is
validated before the limit is consumed, so a rejected title costs nothing.
Votes are not limited: a vote is a toggle on a row keyed by post and user, so
repeating it cannot add anything.

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
