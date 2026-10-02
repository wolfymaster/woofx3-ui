import type { FeedbackStatus } from "@convex/lib/feedback";
import { FEEDBACK_STATUSES } from "@/lib/feedback";
import { cn } from "@/lib/utils";

export function FeedbackStatusBadge({ status }: { status: FeedbackStatus }) {
  const { label, className } = FEEDBACK_STATUSES[status];
  return (
    <span
      className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}
      data-testid={`badge-feedback-status-${status}`}
    >
      {label}
    </span>
  );
}
