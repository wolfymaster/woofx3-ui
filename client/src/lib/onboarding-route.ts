export type OnboardingRoute =
  /** A registered or building instance exists, so setup knows where the user belongs. */
  | "setup"
  /** Ask for the address of an engine the user runs. */
  | "own-engine-form"
  /** A pull request preview's paired engine: connect it without asking. */
  | "paired-engine"
  /** Make the rows the connect screen works on; the engine follows connecting. */
  | "managed";

export interface OnboardingFacts {
  instances: ReadonlyArray<{ clientId?: string; hosting?: "managed" | "external" }>;
  wantsOwnEngine: boolean;
  /** Pressed "Let woofx3 run it for you", which outranks the form and a paired engine that would not connect. */
  choseManaged: boolean;
  hasPreviewEngine: boolean;
  managedAvailable: boolean;
}

export function onboardingRoute(facts: OnboardingFacts): OnboardingRoute {
  if (facts.instances.some((instance) => instance.clientId)) {
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
  if (facts.hasPreviewEngine) {
    return "paired-engine";
  }
  return facts.managedAvailable ? "managed" : "own-engine-form";
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
