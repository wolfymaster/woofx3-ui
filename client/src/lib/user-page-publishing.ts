/**
 * What the user page screen shows about publishing: the page's state and
 * whether its Publish and Unpublish buttons work for this viewer. The server
 * enforces the same rules (convex/userPages.ts); this only keeps the screen
 * from offering a button that is certain to be refused, and says why.
 */

export const NO_SLUG_MESSAGE = "Only engines with a woofx3 address can have a page.";
export const NOT_ENTITLED_MESSAGE = "Your plan doesn't include a public page for this engine. Upgrade to publish it.";
export const ADMINS_ONLY_MESSAGE = "Only the account's owner and admins can publish or unpublish the page.";

export type PageStatus =
  /** Never published, or taken offline. */
  | { kind: "unpublished" }
  /** Live, and the saved draft is what is live. */
  | { kind: "live"; publishedAt: number }
  /** Live, with a saved draft newer than what visitors see. */
  | { kind: "live_behind"; publishedAt: number };

export interface PublishFacts {
  isAdmin: boolean;
  /** Null when the instance has no woofx3 address to publish under. */
  slug: string | null;
  /** Whether the plan lets this instance have a live page. */
  canPublish: boolean;
  draftRevision: number;
  published: { revision: number; publishedAt: number } | null;
  /** The editor holds edits that are not saved yet. */
  dirty: boolean;
  /** The editor's content has problems the checks found. */
  hasProblems: boolean;
}

/** A button's standing: hidden, shown and usable, or shown but disabled with the reason. */
export type ButtonGate = { kind: "hidden" } | { kind: "enabled" } | { kind: "disabled"; reason: string };

export function pageStatus(facts: Pick<PublishFacts, "draftRevision" | "published">): PageStatus {
  const { published } = facts;
  if (published === null) {
    return { kind: "unpublished" };
  }
  return published.revision === facts.draftRevision
    ? { kind: "live", publishedAt: published.publishedAt }
    : { kind: "live_behind", publishedAt: published.publishedAt };
}

/**
 * Publish puts the saved draft live, so it waits for a save; the reasons are
 * checked broadest first, so the one shown is the one to act on first.
 */
export function publishGate(facts: PublishFacts): ButtonGate {
  if (!facts.isAdmin) {
    return { kind: "disabled", reason: ADMINS_ONLY_MESSAGE };
  }
  if (facts.slug === null) {
    return { kind: "disabled", reason: NO_SLUG_MESSAGE };
  }
  if (!facts.canPublish) {
    return { kind: "disabled", reason: NOT_ENTITLED_MESSAGE };
  }
  if (facts.hasProblems) {
    return { kind: "disabled", reason: "Fix the problems marked on the page first." };
  }
  if (facts.dirty || facts.draftRevision === 0) {
    return { kind: "disabled", reason: "Save the draft first; publishing puts the saved draft live." };
  }
  if (pageStatus(facts).kind === "live") {
    return { kind: "disabled", reason: "Visitors already see this draft." };
  }
  return { kind: "enabled" };
}

/** Unpublishing needs only an admin and a live page; a member sees why they cannot. */
export function unpublishGate(facts: Pick<PublishFacts, "isAdmin" | "published">): ButtonGate {
  if (facts.published === null) {
    return { kind: "hidden" };
  }
  if (!facts.isAdmin) {
    return { kind: "disabled", reason: ADMINS_ONLY_MESSAGE };
  }
  return { kind: "enabled" };
}
