import { unapprovedPermissions } from "@convex/lib/modulePermissions";

/**
 * Plain-language wording for the permission ids a module manifest may declare.
 * The ids must match KNOWN_PERMISSIONS in the engine's
 * barkloader/lib_sandbox/src/permissions.rs; an id missing here still renders,
 * flagged as unknown, so an engine that learns a new permission before this
 * table does never hides a request from the streamer.
 */
const PERMISSION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "twitch.moderation": "Time out chatters in your Twitch chat",
  "twitch.channel": "Change your stream title, category and tags",
  "obs.control": "Control OBS: switch scenes, show and hide sources, mute audio inputs",
};

export interface DescribedPermission {
  id: string;
  description: string;
  known: boolean;
}

export function describePermission(id: string): DescribedPermission {
  const description = Object.hasOwn(PERMISSION_DESCRIPTIONS, id) ? PERMISSION_DESCRIPTIONS[id] : undefined;
  if (description === undefined) {
    return { id, description: `Unknown permission: ${id}`, known: false };
  }
  return { id, description, known: true };
}

export function describePermissions(ids: readonly string[]): DescribedPermission[] {
  return ids.map(describePermission);
}

/**
 * The permissions a streamer has to approve before `next` is installed: all of
 * them for a fresh install, and only those the installed version did not
 * already declare for an upgrade. A permission the upgrade drops needs no
 * approval.
 */
export function permissionsToApprove(next: readonly string[], installed: readonly string[] | null): string[] {
  return unapprovedPermissions(next, installed ?? []);
}
