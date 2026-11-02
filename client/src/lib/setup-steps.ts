// The setup wizard's pages, in order. Each is its own route under /setup, so
// the browser's back button, a reload and the Twitch OAuth round trip all land
// on the page the user was on.

export const SETUP_STEPS = [
  { id: "connect", title: "Connect Your Streaming Platform" },
  { id: "overlay", title: "Your overlay" },
  { id: "finish", title: "All set" },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]["id"];

export function isSetupStepId(value: string | undefined): value is SetupStepId {
  return SETUP_STEPS.some((step) => step.id === value);
}

export function setupStepPath(step: SetupStepId): string {
  return `/setup/${step}`;
}

export function setupStepIndex(step: SetupStepId): number {
  return SETUP_STEPS.findIndex((candidate) => candidate.id === step);
}

/** The parts of setup status that decide which step is next. */
export interface SetupProgress {
  twitchUsername: string | null;
  /** False only on a preview deployment where the connection was skipped. */
  twitchRequired: boolean;
  /** No username could be derived, so the connect page asks for one. */
  usernameNeeded: boolean;
  completedAt: number | null;
  overlayPending: boolean;
}

/**
 * Whether the connect page has nothing left to do. Connecting finishes setup
 * on the server, so no later page can leave the account half set up.
 */
function isConnected(progress: SetupProgress): boolean {
  const twitchSettled = !progress.twitchRequired || progress.twitchUsername !== null;
  return twitchSettled && progress.completedAt !== null && !progress.usernameNeeded;
}

/** Where a user with no particular page in mind belongs. */
export function firstIncompleteStep(progress: SetupProgress): SetupStepId {
  if (!isConnected(progress)) {
    return "connect";
  }
  // Past the overlay page, the last page opens the dashboard once the engine is
  // registered, so a skip made during the build comes back to the wait.
  return progress.overlayPending ? "overlay" : "finish";
}

/**
 * `requested` when the user may be on it. Nothing comes before connecting, and
 * the connect page moves on by itself once it is done, which is how returning
 * from Twitch continues with no click.
 */
export function allowedSetupStep(requested: SetupStepId, progress: SetupProgress): SetupStepId {
  if (!isConnected(progress)) {
    return "connect";
  }
  if (requested === "connect" || (requested === "finish" && progress.overlayPending)) {
    return firstIncompleteStep(progress);
  }
  return requested;
}

/** The overlay page links here when there is no follow alert to test, to make one. */
export const ALERTS_PATH = "/stream/alerts";

/** Whether the guard sends the user to the overlay page from `path`. */
export function overlayPageRedirects(overlayPending: boolean, path: string): boolean {
  return overlayPending && path !== ALERTS_PATH;
}

/** A navigation the wizard should make: forward to the next step, or back to one the user may be on. */
export interface SetupRedirect {
  step: SetupStepId;
  /** True when the requested step was not allowed, so it should not stay in the history. */
  replace: boolean;
}

/**
 * Where the wizard goes from `requested`, or null to stay.
 *
 * `advancingTo` is the step a finished step asked to go on to. It is followed
 * only once `progress` allows it: a step saves its answer and then asks to go
 * on, and the saved answer can reach `progress` a render after that. Going on
 * at once would open the next step against the old progress, which sends the
 * user straight back to the step they just finished.
 */
export function setupRedirect(
  requested: SetupStepId | null,
  advancingTo: SetupStepId | null,
  progress: SetupProgress
): SetupRedirect | null {
  if (advancingTo !== null && advancingTo !== requested && allowedSetupStep(advancingTo, progress) === advancingTo) {
    return { step: advancingTo, replace: false };
  }
  const allowed = requested === null ? firstIncompleteStep(progress) : allowedSetupStep(requested, progress);
  return allowed === requested ? null : { step: allowed, replace: true };
}
