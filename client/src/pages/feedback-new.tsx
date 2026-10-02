import { api } from "@convex/_generated/api";
import { FEEDBACK_BODY_MAX, FEEDBACK_TITLE_MAX, FEEDBACK_TITLE_MIN, type FeedbackKind } from "@convex/lib/feedback";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ChevronUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { FeedbackStatusBadge } from "@/components/feedback/feedback-status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "@/hooks/use-toast";
import { FEEDBACK_KINDS, FEEDBACK_PATH, feedbackErrorMessage, feedbackPostPath } from "@/lib/feedback";

const SIMILAR_DEBOUNCE_MS = 300;

/** Posts whose titles match the draft title, offered so people vote on an existing post rather than duplicate it. */
function SimilarPosts({ title }: { title: string }) {
  const settledTitle = useDebouncedValue(title.trim(), SIMILAR_DEBOUNCE_MS);
  const similar = useQuery(api.feedback.findSimilar, settledTitle.length >= 3 ? { title: settledTitle } : "skip");
  if (!similar || similar.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2" data-testid="feedback-similar">
      <p className="text-sm text-muted-foreground">Already posted? Vote for it instead:</p>
      <ul className="rounded-md border divide-y divide-border">
        {similar.map((post) => (
          <li key={post._id}>
            <Link
              href={feedbackPostPath(post._id)}
              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
              data-testid={`link-similar-${post._id}`}
            >
              <span className="inline-flex w-10 shrink-0 items-center gap-0.5 text-muted-foreground tabular-nums">
                <ChevronUp className="h-3.5 w-3.5" />
                {post.voteCount}
              </span>
              <span className="min-w-0 flex-1 truncate">{post.title}</span>
              <FeedbackStatusBadge status={post.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FeedbackNew() {
  const [, navigate] = useLocation();
  const create = useMutation(api.feedback.create);
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedTitleLength = title.trim().length;
  const canSubmit = trimmedTitleLength >= FEEDBACK_TITLE_MIN && !isSubmitting;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    try {
      const postId = await create({ kind, title, body });
      navigate(feedbackPostPath(postId));
    } catch (error) {
      toast({ title: "Could not post", description: feedbackErrorMessage(error), variant: "destructive" });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <Link
        href={FEEDBACK_PATH}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        data-testid="link-feedback-back"
      >
        <ArrowLeft className="h-4 w-4" />
        All feedback
      </Link>
      <PageHeader title="New post" description="Everyone on woofx3 can see, vote on and comment on what you post." />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>Type</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={kind}
                onValueChange={(next) => {
                  if (next) {
                    setKind(next as FeedbackKind);
                  }
                }}
                className="justify-start"
              >
                {(Object.keys(FEEDBACK_KINDS) as FeedbackKind[]).map((value) => (
                  <ToggleGroupItem key={value} value={value} data-testid={`toggle-feedback-kind-${value}`}>
                    {FEEDBACK_KINDS[value].label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">{FEEDBACK_KINDS[kind].description}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback-title">Title</Label>
              <Input
                id="feedback-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={FEEDBACK_TITLE_MAX}
                placeholder={kind === "bug" ? "What went wrong?" : "What would you like?"}
                autoFocus
                data-testid="input-feedback-title"
              />
              <SimilarPosts title={title} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback-body">Details</Label>
              <Textarea
                id="feedback-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={FEEDBACK_BODY_MAX}
                rows={8}
                placeholder={
                  kind === "bug"
                    ? "What did you do, what did you expect, and what happened instead?"
                    : "What problem would this solve for you?"
                }
                data-testid="input-feedback-body"
              />
              <p className="text-xs text-muted-foreground text-right tabular-nums">
                {body.length.toLocaleString()} / {FEEDBACK_BODY_MAX.toLocaleString()}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" asChild>
                <Link href={FEEDBACK_PATH}>Cancel</Link>
              </Button>
              <Button type="submit" disabled={!canSubmit} data-testid="button-feedback-submit">
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Post
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
