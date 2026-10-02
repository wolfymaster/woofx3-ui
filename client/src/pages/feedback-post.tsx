import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FeedbackCommentView } from "@convex/feedback";
import { FEEDBACK_COMMENT_MAX } from "@convex/lib/feedback";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2, SearchX } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "wouter";
import { EmptyState } from "@/components/common/empty-state";
import { FeedbackPostMeta } from "@/components/feedback/feedback-post-meta";
import { VoteButton } from "@/components/feedback/vote-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { FEEDBACK_PATH, feedbackErrorMessage } from "@/lib/feedback";

const COMMENT_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function BackLink() {
  return (
    <Link
      href={FEEDBACK_PATH}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      data-testid="link-feedback-back"
    >
      <ArrowLeft className="h-4 w-4" />
      All feedback
    </Link>
  );
}

function Comment({ comment }: { comment: FeedbackCommentView }) {
  return (
    <li className="flex gap-3 py-4" data-testid={`feedback-comment-${comment._id}`}>
      <Avatar className="h-8 w-8">
        {comment.author.image && <AvatarImage src={comment.author.image} alt="" />}
        <AvatarFallback>{comment.author.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{comment.author.name}</span> ·{" "}
          {new Date(comment._creationTime).toLocaleString(undefined, COMMENT_TIME_FORMAT)}
        </div>
        <p className="text-sm whitespace-pre-line break-words">{comment.body}</p>
      </div>
    </li>
  );
}

function CommentForm({ postId }: { postId: Id<"feedbackPosts"> }) {
  const addComment = useMutation(api.feedback.addComment);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = body.trim().length > 0 && !isSubmitting;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    try {
      await addComment({ postId, body });
      setBody("");
    } catch (error) {
      toast({ title: "Could not comment", description: feedbackErrorMessage(error), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={FEEDBACK_COMMENT_MAX}
        rows={3}
        placeholder="Add a comment"
        aria-label="Comment"
        data-testid="input-feedback-comment"
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit} data-testid="button-feedback-comment">
          {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Comment
        </Button>
      </div>
    </form>
  );
}

function Comments({ postId }: { postId: Id<"feedbackPosts"> }) {
  const comments = useQuery(api.feedback.listComments, { postId });
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Comments</h2>
      {comments === undefined ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {comments.map((comment) => (
            <Comment key={comment._id} comment={comment} />
          ))}
        </ul>
      )}
      <CommentForm postId={postId} />
    </section>
  );
}

export default function FeedbackPost() {
  const params = useParams<{ postId: string }>();
  const post = useQuery(api.feedback.get, { postId: params.postId });

  if (post === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (post === null) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <BackLink />
        <EmptyState icon={SearchX} title="Post not found" description="It may have been removed." />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-8">
      <div>
        <BackLink />
        <Card>
          <CardContent className="pt-6 flex items-start gap-4">
            <VoteButton postId={post._id} voteCount={post.voteCount} hasVoted={post.hasVoted} />
            <div className="min-w-0 flex-1 space-y-3">
              <h1 className="text-xl font-semibold leading-snug" data-testid="text-page-title">
                {post.title}
              </h1>
              <FeedbackPostMeta post={post} />
              {post.body && <p className="text-sm whitespace-pre-line break-words">{post.body}</p>}
            </div>
          </CardContent>
        </Card>
      </div>
      <Comments postId={post._id} />
    </div>
  );
}
