import type { FeedbackPostView } from "@convex/feedback";
import { Bug, Lightbulb, MessageSquare } from "lucide-react";
import { FeedbackStatusBadge } from "@/components/feedback/feedback-status-badge";
import { FEEDBACK_KINDS } from "@/lib/feedback";

const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

/** Status, kind, author, date and comment count: the line under a post's title on the board and its own page. */
export function FeedbackPostMeta({ post }: { post: FeedbackPostView }) {
  const KindIcon = post.kind === "bug" ? Bug : Lightbulb;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <FeedbackStatusBadge status={post.status} />
      <span className="inline-flex items-center gap-1">
        <KindIcon className="h-3.5 w-3.5" />
        {FEEDBACK_KINDS[post.kind].label}
      </span>
      <span>
        {post.author.name} · {new Date(post._creationTime).toLocaleDateString(undefined, DATE_FORMAT)}
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <MessageSquare className="h-3.5 w-3.5" />
        {post.commentCount.toLocaleString()}
      </span>
    </div>
  );
}
