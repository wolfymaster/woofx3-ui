import { api } from "@convex/_generated/api";
import type { FeedbackPostView } from "@convex/feedback";
import type { FeedbackStatus } from "@convex/lib/feedback";
import { usePaginatedQuery } from "convex/react";
import { Loader2, MessageSquarePlus, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { EmptyState } from "@/components/common/empty-state";
import { FeedbackPostMeta } from "@/components/feedback/feedback-post-meta";
import { VoteButton } from "@/components/feedback/vote-button";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FEEDBACK_NEW_PATH, FEEDBACK_STATUS_ORDER, FEEDBACK_STATUSES, feedbackPostPath } from "@/lib/feedback";

const PAGE_SIZE = 20;

type Sort = "top" | "new";
type StatusFilter = FeedbackStatus | "all";

function PostRow({ post }: { post: FeedbackPostView }) {
  return (
    <Link
      href={feedbackPostPath(post._id)}
      className="flex items-start gap-4 px-4 py-3 hover:bg-muted/50 transition-colors"
      data-testid={`link-feedback-${post._id}`}
    >
      <VoteButton postId={post._id} voteCount={post.voteCount} hasVoted={post.hasVoted} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium leading-snug">{post.title}</div>
        {post.body && <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-line">{post.body}</p>}
        <FeedbackPostMeta post={post} />
      </div>
    </Link>
  );
}

export default function Feedback() {
  const [, navigate] = useLocation();
  const [sort, setSort] = useState<Sort>("top");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { results, status, loadMore } = usePaginatedQuery(
    api.feedback.list,
    { sort, ...(statusFilter === "all" ? {} : { status: statusFilter }) },
    { initialNumItems: PAGE_SIZE }
  );

  let content: React.ReactNode;
  if (status === "LoadingFirstPage") {
    content = (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (results.length === 0) {
    content =
      statusFilter === "all" ? (
        <EmptyState
          icon={MessageSquarePlus}
          title="No feedback yet"
          description="Be the first to suggest an idea or report a bug."
          action={{ label: "New post", onClick: () => navigate(FEEDBACK_NEW_PATH) }}
        />
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground" data-testid="feedback-empty-filtered">
          Nothing is {FEEDBACK_STATUSES[statusFilter].label.toLowerCase()} right now.
        </p>
      );
  } else {
    content = (
      <div className="space-y-4">
        <Card className="divide-y divide-border overflow-hidden">
          {results.map((post) => (
            <PostRow key={post._id} post={post} />
          ))}
        </Card>
        {status !== "Exhausted" && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => loadMore(PAGE_SIZE)}
              disabled={status === "LoadingMore"}
              data-testid="button-feedback-load-more"
            >
              {status === "LoadingMore" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Load more
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <PageHeader
        title="Feedback"
        description="Suggest ideas, report bugs, and vote for what you want next. Everyone on woofx3 sees this board."
        actions={
          <Button asChild data-testid="button-feedback-new">
            <Link href={FEEDBACK_NEW_PATH}>
              <Plus className="h-4 w-4 mr-2" />
              New post
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <ToggleGroup
          type="single"
          variant="outline"
          value={sort}
          onValueChange={(next) => {
            if (next) {
              setSort(next as Sort);
            }
          }}
          aria-label="Sort"
        >
          <ToggleGroupItem value="top" data-testid="toggle-feedback-top">
            Top
          </ToggleGroupItem>
          <ToggleGroupItem value="new" data-testid="toggle-feedback-new">
            New
          </ToggleGroupItem>
        </ToggleGroup>

        <Select value={statusFilter} onValueChange={(next) => setStatusFilter(next as StatusFilter)}>
          <SelectTrigger className="w-44" aria-label="Status" data-testid="select-feedback-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {FEEDBACK_STATUS_ORDER.map((value) => (
              <SelectItem key={value} value={value}>
                {FEEDBACK_STATUSES[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {content}
    </div>
  );
}
