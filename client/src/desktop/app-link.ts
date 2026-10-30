import type { CompanionLinkStatus } from "@desktop-host/window";

/**
 * When the desktop dashboard makes its computer the selected instance's
 * companion. It tries once per instance per run of the app, so a refusal or
 * an error is never retried in a loop; the person retries from the prompt.
 */

export interface AppLinkViewer<Id extends string> {
  /** The selected instance: undefined while loading, null when there is none. */
  instanceId: Id | null | undefined;
  /** Whether the viewer is an admin of it: undefined while loading. */
  isAdmin: boolean | undefined;
}

export type AppLinkGate<Id extends string> = { kind: "wait" } | { kind: "skip" } | { kind: "check"; instanceId: Id };

/**
 * Whether to look at the host's pairing for this viewer. Only an admin may
 * make a computer the instance's companion, so anyone else is skipped
 * without a word.
 */
export function appLinkGate<Id extends string>(
  viewer: AppLinkViewer<Id>,
  attempted: ReadonlySet<string>
): AppLinkGate<Id> {
  if (viewer.instanceId === undefined || viewer.isAdmin === undefined) {
    return { kind: "wait" };
  }
  if (viewer.instanceId === null || !viewer.isAdmin || attempted.has(viewer.instanceId)) {
    return { kind: "skip" };
  }
  return { kind: "check", instanceId: viewer.instanceId };
}

/**
 * Whether this computer must be linked to `instanceId`: it is not the
 * instance's companion yet. A pairing stored before the host kept instance
 * ids names none, so which instance it belongs to cannot be told; it is
 * left alone rather than replaced on a guess.
 */
export function needsAppLink(status: CompanionLinkStatus, instanceId: string): boolean {
  const linked = status.linked;
  if (linked === null) {
    return true;
  }
  if (linked.instanceId === null) {
    return false;
  }
  return linked.instanceId !== instanceId;
}
