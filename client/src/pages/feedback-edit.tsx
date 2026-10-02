import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Lock, SearchX } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { EmptyState } from "@/components/common/empty-state";
import { FeedbackBackLink } from "@/components/feedback/feedback-back-link";
import { FeedbackPostForm } from "@/components/feedback/feedback-post-form";
import { PageHeader } from "@/components/layout/page-header";
import { FEEDBACK_PATH, feedbackPostPath } from "@/lib/feedback";

export default function FeedbackEdit() {
  const params = useParams<{ postId: string }>();
  const [, navigate] = useLocation();
  const post = useQuery(api.feedback.get, { postId: params.postId });
  const update = useMutation(api.feedback.update);

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
        <FeedbackBackLink href={FEEDBACK_PATH} label="All feedback" />
        <EmptyState icon={SearchX} title="Post not found" description="It may have been deleted." />
      </div>
    );
  }

  const postPath = feedbackPostPath(post._id);

  if (!post.canChange) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <FeedbackBackLink href={postPath} label="Back to post" />
        <EmptyState
          icon={Lock}
          title="This post can't be edited"
          description={
            post.isAuthor
              ? "It has been reviewed, so it stays as voters saw it."
              : "Only the person who posted it can edit it."
          }
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <FeedbackBackLink href={postPath} label="Back to post" />
      <PageHeader title="Edit post" />
      <FeedbackPostForm
        // Keyed by post so a different post's edit page starts from its own text.
        key={post._id}
        initial={{ kind: post.kind, title: post.title, body: post.body }}
        submitLabel="Save"
        errorTitle="Could not save"
        cancelHref={postPath}
        suggestSimilar={false}
        onSubmit={async (draft) => {
          await update({ postId: post._id, ...draft });
          navigate(postPath);
        }}
      />
    </div>
  );
}
