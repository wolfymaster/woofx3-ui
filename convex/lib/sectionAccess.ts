import type { LockedSectionReason, SectionVisibility } from "@shared/user-pages";
import type { SubscriberTier } from "./viewerAuth";

/**
 * Who a page read is answering, as far as section visibility cares. Kept free
 * of Convex imports so every visibility and viewer state can be tested
 * directly.
 *
 * `known` roles are always fresh: a viewerRoles row exists only until
 * VIEWER_ROLES_TTL_MS after its check (viewerRoles.ts schedules its
 * deletion), so the read needs no clock to tell fresh from stale.
 */
export type PageViewer =
  | { kind: "anonymous" }
  | {
      kind: "signed_in";
      roles:
        | { kind: "known"; follower: boolean; subscriberTier: SubscriberTier | null }
        /** Never checked on this channel, or the last check expired. */
        | { kind: "unknown" }
        /** The page's channel cannot be checked for this viewer at all. */
        | { kind: "uncheckable" };
    };

export type SectionAccess = { kind: "open" } | { kind: "locked"; reason: LockedSectionReason };

const OPEN: SectionAccess = { kind: "open" };

function locked(reason: LockedSectionReason): SectionAccess {
  return { kind: "locked", reason };
}

/**
 * Whether `viewer` may see a section with `visibility`. Anything short of
 * proof that they may is locked: a section is never opened on roles the read
 * does not have.
 */
export function sectionAccess(visibility: SectionVisibility, viewer: PageViewer): SectionAccess {
  if (visibility.kind === "public") {
    return OPEN;
  }
  if (viewer.kind === "anonymous") {
    return locked("sign_in");
  }
  if (visibility.kind === "signed_in") {
    return OPEN;
  }
  const { roles } = viewer;
  if (roles.kind === "unknown") {
    return locked("roles_unknown");
  }
  if (roles.kind === "uncheckable") {
    return locked("unverifiable");
  }
  let meets: boolean;
  switch (visibility.kind) {
    case "follower":
      meets = roles.follower;
      break;
    case "subscriber":
      meets = roles.subscriberTier !== null;
      break;
    case "tier":
      meets = roles.subscriberTier !== null && roles.subscriberTier >= visibility.level;
      break;
  }
  return meets ? OPEN : locked("not_eligible");
}
