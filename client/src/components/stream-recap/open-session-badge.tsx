import { Badge } from "@/components/ui/badge";

/**
 * Marks a summary taken while its session was still open: its totals can still
 * grow, so it is not a finished stream's final figures.
 */
export function OpenSessionBadge() {
  return (
    <Badge variant="secondary" className="text-xs font-normal" data-testid="badge-session-open">
      In progress
    </Badge>
  );
}
