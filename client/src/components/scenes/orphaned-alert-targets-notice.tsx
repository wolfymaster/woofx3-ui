import type { OrphanedAlertTarget } from "@shared/alert-widgets";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Who plays alerts on a target, in a phrase: `Follow alert (workflow), !hype (command)`. */
export function alertTargetUsesText(target: OrphanedAlertTarget): string {
  return target.uses.map((use) => `${use.name} (${use.kind})`).join(", ");
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
      <AlertTitle>Some alerts will have nowhere to play</AlertTitle>
      <AlertDescription className="space-y-1">
        <ul className="list-disc pl-4">
          {targets.map((target) => (
            <li key={target.target}>
              <span className="font-medium">“{target.target}”</span>: {alertTargetUsesText(target)}
            </li>
          ))}
        </ul>
        <p>
          With this change no alert area on any scene has {targets.length === 1 ? "that name" : "those names"}. Name an
          alert area to match, or change the target in those steps.
        </p>
      </AlertDescription>
    </Alert>
  );
}
