import type { LockedSectionReason, SectionRequirement } from "@shared/user-pages";
import { type PageViewer, usePageViewer } from "./page-viewer";
import { SignInButton } from "./sign-in-button";

/** Who a section is for, as its plate reads. */
export function requirementLabel(requirement: SectionRequirement): string {
  switch (requirement.kind) {
    case "signed_in":
      return "Signed-in viewers";
    case "follower":
      return "Followers only";
    case "subscriber":
      return "Subscribers only";
    case "tier":
      return requirement.level === 3 ? "Tier 3 subscribers" : `Tier ${requirement.level} subscribers and up`;
  }
}

function eligibilityHint(requirement: SectionRequirement): string {
  switch (requirement.kind) {
    case "signed_in":
      return "Sign in with Twitch to see this.";
    case "follower":
      return "Follow the channel on Twitch to see this. A new follow can take a few minutes to show up here.";
    case "subscriber":
      return "Subscribe to the channel on Twitch to see this. A new sub can take a few minutes to show up here.";
    case "tier":
      return `Subscribe at tier ${requirement.level}${requirement.level === 3 ? "" : " or higher"} on Twitch to see this.`;
  }
}

export type LockedSectionAction = "sign_in" | "sign_in_again" | "open_canonical" | null;

export interface LockedSectionCopy {
  message: string;
  action: LockedSectionAction;
  /** Whether the page is still finding out; the plate's tab blinks while it is. */
  pending: boolean;
}

/** What a locked section tells this viewer, and the one thing it offers them to do. */
export function lockedSectionCopy(
  requirement: SectionRequirement,
  reason: LockedSectionReason,
  viewer: Pick<PageViewer, "session" | "canSignIn" | "roleCheck">
): LockedSectionCopy {
  switch (reason) {
    case "sign_in":
      if (viewer.session.status === "signing_in") {
        return { message: "Signing you in…", action: null, pending: true };
      }
      return viewer.canSignIn
        ? { message: "Sign in with Twitch to see whether you can view this.", action: "sign_in", pending: false }
        : { message: "Open this page on woofx3 to sign in and see this.", action: "open_canonical", pending: false };
    case "roles_unknown":
      switch (viewer.roleCheck) {
        case "reauth":
          return {
            message: "Sign in again so we can check your Twitch account.",
            action: "sign_in_again",
            pending: false,
          };
        case "stopped":
          return { message: "This section can't be unlocked on this page right now.", action: null, pending: false };
        case "retrying":
          return { message: "Twitch didn't answer. We'll keep trying.", action: null, pending: true };
        case "idle":
        case "checking":
          return { message: "Checking your Twitch account…", action: null, pending: true };
      }
      break;
    case "not_eligible":
      return { message: eligibilityHint(requirement), action: null, pending: false };
    case "unverifiable":
      return { message: "This section can't be unlocked on this page right now.", action: null, pending: false };
  }
  throw new Error(`no copy for a section locked for ${reason}`);
}

/**
 * A section this viewer may not see, shown as an off-air slate: the page's
 * scanlines, a lower-third plate naming who it is for, and the next step.
 * It holds nothing of the section but its requirement; the read sends no more.
 */
export function LockedSectionView({
  requirement,
  reason,
}: {
  requirement: SectionRequirement;
  reason: LockedSectionReason;
}) {
  const viewer = usePageViewer();
  const copy = lockedSectionCopy(requirement, reason, viewer);
  return (
    <section
      aria-label={`${requirementLabel(requirement)}: locked`}
      className="locked-slate overflow-hidden rounded-2xl border border-line p-5 sm:p-6"
    >
      <div className="flex items-stretch">
        <span
          className={`w-2 shrink-0 bg-accent ${copy.pending ? "motion-safe:animate-pulse" : ""}`}
          aria-hidden="true"
        />
        <p className="bg-ink px-3 py-1 font-bold tracking-tight text-paper">{requirementLabel(requirement)}</p>
      </div>
      <p role={copy.pending ? "status" : undefined} className="mt-4 max-w-prose text-muted">
        {copy.message}
      </p>
      {copy.action !== null && (
        <div className="mt-4">
          <LockedSectionActionView action={copy.action} viewer={viewer} />
        </div>
      )}
    </section>
  );
}

function LockedSectionActionView({ action, viewer }: { action: NonNullable<LockedSectionAction>; viewer: PageViewer }) {
  switch (action) {
    case "sign_in":
      return <SignInButton label="Sign in with Twitch" onClick={viewer.signIn} />;
    case "sign_in_again":
      return <SignInButton label="Sign in again" onClick={viewer.signIn} />;
    case "open_canonical":
      return (
        <a
          href={viewer.canonicalUrl}
          className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4"
        >
          Open on woofx3
        </a>
      );
  }
}
