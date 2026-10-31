import { Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useFormSubmissionQueueStatus,
  useFormSubmissions,
  useRetryFormSubmissionRequest,
} from "@/engine/hooks/use-form-submissions";
import type { FormSubmission } from "@/engine/types";
import { toast } from "@/hooks/use-toast";
import { engineProblemMessage, submissionAnswerText, submissionStatusLabel } from "@/lib/user-page-submissions";

const PAGE_SIZE = 25;

const STATUS_VARIANT = {
  pending: "secondary",
  delivered: "default",
  failed: "destructive",
} as const;

/** What visitors sent through one form and whether each answer reached the engine. */
export function SubmissionsPanel({ formId }: { formId: string }) {
  const status = useFormSubmissionQueueStatus();
  const { results, status: listStatus, loadMore } = useFormSubmissions(formId, PAGE_SIZE);

  return (
    <div className="space-y-4" data-testid="submissions-panel">
      {status?.engineProblem && (
        <Alert data-testid="alert-submissions-engine">
          <AlertTitle>
            {status.pendingCount === 1 ? "1 answer waiting" : `${status.pendingCount} answers waiting`}
          </AlertTitle>
          <AlertDescription>{engineProblemMessage(status.engineProblem)}</AlertDescription>
        </Alert>
      )}
      {status?.atCapacity && (
        <Alert variant="destructive" data-testid="alert-submissions-full">
          <AlertTitle>Your forms have stopped accepting answers</AlertTitle>
          <AlertDescription>
            Too many answers are waiting to reach your engine. They'll reopen as those are sent.
          </AlertDescription>
        </Alert>
      )}
      {listStatus === "LoadingFirstPage" && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {listStatus !== "LoadingFirstPage" && results.length === 0 && (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No answers yet. They'll show up here when visitors send this form on your page.
        </div>
      )}
      {results.map((submission) => (
        <SubmissionCard key={submission.id} submission={submission} />
      ))}
      {listStatus === "CanLoadMore" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadMore(PAGE_SIZE)}
          data-testid="button-load-more-submissions"
        >
          Show more
        </Button>
      )}
    </div>
  );
}

function SubmissionCard({ submission }: { submission: FormSubmission }) {
  const retry = useRetryFormSubmissionRequest();
  const [retrying, setRetrying] = useState(false);

  const onRetry = async () => {
    setRetrying(true);
    try {
      await retry(submission.id);
    } catch {
      toast({ title: "Couldn't retry that answer", variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Card data-testid={`submission-${submission.id}`}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{submission.formTitle ?? "Form"}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {new Date(submission.submittedAt).toLocaleString()} ·{" "}
            {submission.viewer ? submission.viewer.displayName : "Anonymous visitor"}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[submission.status]}>{submissionStatusLabel(submission.status)}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-2 text-sm">
          {submission.fields.map((field) => (
            <div key={field.id}>
              <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
              <dd className="whitespace-pre-wrap break-words">{submissionAnswerText(field.value)}</dd>
            </div>
          ))}
        </dl>
        {submission.status === "pending" && submission.lastError !== null && (
          <p className="text-xs text-muted-foreground">Last try didn't get through: {submission.lastError}</p>
        )}
        {submission.status === "failed" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-destructive">
              {submission.failureReason ?? "Your engine refused this answer."}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={retrying}
              onClick={onRetry}
              data-testid={`button-retry-${submission.id}`}
            >
              {retrying ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Retry
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
