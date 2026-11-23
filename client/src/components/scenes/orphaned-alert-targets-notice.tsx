import type { OrphanedAlertTarget } from "@shared/alert-widgets";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Who plays alerts on a target, in a phrase: `Follow alert, !hype`. */
export function alertTargetUsesText(target: OrphanedAlertTarget): string {
  return target.uses.map((use) => use.name).join(", ");
}

/**
 * Warns that the scene as edited leaves Alert steps with no alert widget to play
 * on, after renaming or removing the only one with their target's name. Their
 * alerts would not show on any scene, and nothing else says so.
 */
export function OrphanedAlertTargetsNotice({ targets }: { targets: readonly OrphanedAlertTarget[] }) {
  if (targets.length === 0) {
    return null;
  }
  return (
    <Alert className="shrink-0 rounded-none border-x-0 border-t-0" data-testid="notice-orphaned-alert-targets">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Some alerts won't show anywhere</AlertTitle>
      <AlertDescription className="space-y-1">
        <ul className="list-disc pl-4">
          {targets.map((target) => (
            <li key={target.target}>
              <span className="font-medium">“{target.target}”</span>: {alertTargetUsesText(target)}
            </li>
          ))}
        </ul>
        <p>
          No alert area is named {targets.length === 1 ? "that" : "those"} now. Rename an alert area to match, or pick a
          different area in those alerts.
        </p>
      </AlertDescription>
    </Alert>
  );
}
