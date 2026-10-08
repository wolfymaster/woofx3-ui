import { Badge } from "@/components/ui/badge";

/**
 * Marks the session whose stream is live right now: its totals are still
 * growing, so they are not a finished stream's final figures.
 */
export function OpenSessionBadge() {
  return (
    <Badge variant="secondary" className="text-xs font-normal" data-testid="badge-session-open">
      In progress
    </Badge>
  );
}
