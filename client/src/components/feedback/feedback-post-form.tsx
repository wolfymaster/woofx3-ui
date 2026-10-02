import { api } from "@convex/_generated/api";
import { FEEDBACK_BODY_MAX, FEEDBACK_TITLE_MAX, FEEDBACK_TITLE_MIN, type FeedbackKind } from "@convex/lib/feedback";
import { useQuery } from "convex/react";
import { ChevronUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { FeedbackStatusBadge } from "@/components/feedback/feedback-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "@/hooks/use-toast";
import { FEEDBACK_KINDS, feedbackErrorMessage, feedbackPostPath } from "@/lib/feedback";

const SIMILAR_DEBOUNCE_MS = 300;

export interface FeedbackPostDraft {
  kind: FeedbackKind;
  title: string;
  body: string;
}

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

interface FeedbackPostFormProps {
  initial: FeedbackPostDraft;
  submitLabel: string;
  /** Toast title when `onSubmit` throws. */
  errorTitle: string;
  cancelHref: string;
  /** Offer existing posts with similar titles; only useful while writing a new post. */
  suggestSimilar: boolean;
  /** Saves the draft; throws to keep the form open with the draft intact. */
  onSubmit: (draft: FeedbackPostDraft) => Promise<void>;
}

/** The kind, title and details form behind both New post and Edit post. */
export function FeedbackPostForm({
  initial,
  submitLabel,
  errorTitle,
  cancelHref,
  suggestSimilar,
  onSubmit,
}: FeedbackPostFormProps) {
  const [kind, setKind] = useState<FeedbackKind>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = title.trim().length >= FEEDBACK_TITLE_MIN && !isSubmitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ kind, title, body });
    } catch (error) {
      toast({ title: errorTitle, description: feedbackErrorMessage(error), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-6">
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
            {suggestSimilar && <SimilarPosts title={title} />}
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
              <Link href={cancelHref}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="button-feedback-submit">
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
