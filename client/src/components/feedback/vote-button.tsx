import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { ChevronUp } from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { feedbackErrorMessage } from "@/lib/feedback";
import { cn } from "@/lib/utils";

interface VoteButtonProps {
  postId: Id<"feedbackPosts">;
  voteCount: number;
  hasVoted: boolean;
  className?: string;
}

/** Upvote toggle. The count and state come back through the subscribed query, so nothing is tracked locally. */
export function VoteButton({ postId, voteCount, hasVoted, className }: VoteButtonProps) {
  const toggleVote = useMutation(api.feedback.toggleVote);
  const [isPending, setIsPending] = useState(false);

  const onClick = async (event: React.MouseEvent) => {
    // The button sits inside a row that links to the post.
    event.preventDefault();
    event.stopPropagation();
    if (isPending) {
      return;
    }
    setIsPending(true);
    try {
      await toggleVote({ postId });
    } catch (error) {
      toast({ title: "Could not vote", description: feedbackErrorMessage(error), variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      aria-pressed={hasVoted}
      aria-label={hasVoted ? `Remove your vote (${voteCount} votes)` : `Vote for this (${voteCount} votes)`}
      className={cn(
        "flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-md border text-sm font-semibold tabular-nums transition-colors disabled:opacity-60",
        hasVoted
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground",
        className
      )}
      data-testid={`button-vote-${postId}`}
    >
      <ChevronUp className="h-4 w-4" />
      {voteCount.toLocaleString()}
    </button>
  );
}
