// The setup wizard's pages, in order. Each is its own route under /setup, so
// the browser's back button, a reload and the Twitch OAuth round trip all land
// on the page the user was on.

export const SETUP_STEPS = [
  { id: "platforms", title: "Choose your platforms" },
  { id: "twitch", title: "Connect Twitch" },
  { id: "import", title: "Bring your setup" },
  { id: "interests", title: "What do you want woofx3 to do?" },
  { id: "dashboard", title: "Your dashboard" },
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
  platformsChosenAt: number | null;
  twitchUsername: string | null;
  importChosenAt: number | null;
  interestsChosenAt: number | null;
  completedAt: number | null;
}

/**
 * The first step not done yet. Steps are done in order, so a user sent to a
 * later step before they got there lands here instead. Skipping the import or
 * the interests question records that it was passed, and the dashboard step is
 * done by finishing setup, so every step has a record of being passed.
 */
export function firstIncompleteStep(progress: SetupProgress): SetupStepId {
  if (progress.platformsChosenAt === null) {
    return "platforms";
  }
  if (progress.twitchUsername === null) {
    return "twitch";
  }
  // Answering the interests question passes the import question too, so a
  // setup that got past it before it was asked does not go back to it.
  if (progress.importChosenAt === null && progress.interestsChosenAt === null) {
    return "import";
  }
  if (progress.interestsChosenAt === null) {
    return "interests";
  }
  if (progress.completedAt === null) {
    return "dashboard";
  }
  // The overlay page is optional and leaves no record, so a finished setup
  // resumes on the summary.
  return "finish";
}

/** `requested` when the user may be on it, otherwise the first step still to do. */
export function allowedSetupStep(requested: SetupStepId, progress: SetupProgress): SetupStepId {
  const firstIncomplete = firstIncompleteStep(progress);
  return setupStepIndex(requested) <= setupStepIndex(firstIncomplete) ? requested : firstIncomplete;
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
