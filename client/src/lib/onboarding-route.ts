export type OnboardingRoute =
  /** A registered or building instance exists, so setup knows where the user belongs. */
  | "setup"
  /** Ask for the address of an engine the user runs. */
  | "own-engine-form"
  /** A pull request preview's paired engine, once the user asked to connect it. */
  | "paired-engine"
  /** Make the rows the connect screen works on; the engine follows connecting. */
  | "managed"
  /** Ask how to run the engine. Nothing is made until the user picks. */
  | "choose";

export interface OnboardingFacts {
  instances: ReadonlyArray<{ engineRegistered?: boolean; hosting?: "managed" | "external" }>;
  wantsOwnEngine: boolean;
  /** Pressed "Let woofx3 run it for you", which outranks the form and a paired engine that would not connect. */
  choseManaged: boolean;
  /** Pressed "Connect this preview's engine". */
  chosePairedEngine: boolean;
  hasPreviewEngine: boolean;
  managedAvailable: boolean;
}

export function onboardingRoute(facts: OnboardingFacts): OnboardingRoute {
  if (facts.instances.some((instance) => instance.engineRegistered)) {
    return "setup";
  }
  if (facts.wantsOwnEngine && !facts.choseManaged) {
    return "own-engine-form";
  }
  if (facts.instances.some((instance) => instance.hosting === "managed")) {
    return "setup";
  }
  if (facts.choseManaged) {
    return "managed";
  }
  if (facts.chosePairedEngine && facts.hasPreviewEngine) {
    return "paired-engine";
  }
  // Making an organization, an engine or a trial takes a press: rendering this page never does.
  return facts.managedAvailable || facts.hasPreviewEngine ? "choose" : "own-engine-form";
}

/**
 * Marks a visit to onboarding as "set up an engine of my own". Without it,
 * onboarding is where the dashboard sends someone who has no engine at all; with
 * it, an engine the user was only invited to does not count as theirs. Marketing
 * sign-up links and the settings page both carry it.
 */
export const NEW_ENGINE_PARAM = "new-engine";

export const NEW_ENGINE_ONBOARDING_PATH = `/auth/onboarding?${NEW_ENGINE_PARAM}=1`;

/** The engines onboarding looks at: only the user's own when they asked to set one up. */
export function enginesForOnboarding<T extends { ownedByMe: boolean }>(
  instances: ReadonlyArray<T>,
  wantsNewEngine: boolean
): T[] {
  return wantsNewEngine ? instances.filter((instance) => instance.ownedByMe) : [...instances];
}

/** The account portal. It is only in the web build, so this is spelled out rather than imported from it. */
export const ACCOUNT_PATH = "/account";

/**
 * Where the dashboard sends a signed-in user it has no engine to open for. An
 * organization owner whose engine is gone sets up another. A plain user, such
 * as a sponsor, is not pushed into making one: they go to their account, which
 * offers it. The desktop app has no account portal, so it always onboards.
 */
export function noEnginePath(facts: { ownsOrganization: boolean; hasAccountPortal: boolean }): string {
  if (facts.ownsOrganization || !facts.hasAccountPortal) {
    return "/auth/onboarding";
  }
  return ACCOUNT_PATH;
}

/**
 * Where /setup goes when there is no engine to set up. `ownsOrganization` is null until the server has answered,
 * and then nothing moves yet.
 */
export function setupWithoutEnginePath(facts: {
  ownsOrganization: boolean | null;
  hasAccountPortal: boolean;
}): string | null {
  if (facts.ownsOrganization === null) {
    return null;
  }
  return noEnginePath({ ownsOrganization: facts.ownsOrganization, hasAccountPortal: facts.hasAccountPortal });
}
