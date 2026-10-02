import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { useLocation } from "wouter";
import { FeedbackBackLink } from "@/components/feedback/feedback-back-link";
import { type FeedbackPostDraft, FeedbackPostForm } from "@/components/feedback/feedback-post-form";
import { PageHeader } from "@/components/layout/page-header";
import { FEEDBACK_PATH, feedbackPostPath } from "@/lib/feedback";

const EMPTY_DRAFT: FeedbackPostDraft = { kind: "idea", title: "", body: "" };

export default function FeedbackNew() {
  const [, navigate] = useLocation();
  const create = useMutation(api.feedback.create);

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <FeedbackBackLink href={FEEDBACK_PATH} label="All feedback" />
      <PageHeader title="New post" description="Everyone on woofx3 can see, vote on and comment on what you post." />
      <FeedbackPostForm
        initial={EMPTY_DRAFT}
        submitLabel="Post"
        errorTitle="Could not post"
        cancelHref={FEEDBACK_PATH}
        suggestSimilar
        onSubmit={async (draft) => {
          const postId = await create(draft);
          navigate(feedbackPostPath(postId));
        }}
      />
    </div>
  );
}
