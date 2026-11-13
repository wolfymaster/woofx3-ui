import { describe, expect, test } from "bun:test";
import { enginesForOnboarding, type OnboardingFacts, type OnboardingRoute, onboardingRoute } from "./onboarding-route";

const none: OnboardingFacts = {
  instances: [],
  wantsOwnEngine: false,
  choseManaged: false,
  hasPreviewEngine: false,
  managedAvailable: true,
};

describe("onboardingRoute", () => {
  test.each<{ name: string; facts: OnboardingFacts; route: OnboardingRoute }>([
    { name: "a new user gets the managed path", facts: none, route: "managed" },
    {
      name: "choosing managed gets past a paired engine that would not connect",
      facts: { ...none, hasPreviewEngine: true, choseManaged: true },
      route: "managed",
    },
    {
      name: "choosing managed gets past the form",
      facts: { ...none, wantsOwnEngine: true, choseManaged: true },
      route: "managed",
    },
    {
      name: "no managed engines leaves the form",
      facts: { ...none, managedAvailable: false },
      route: "own-engine-form",
    },
    {
      name: "a preview connects its paired engine",
      facts: { ...none, hasPreviewEngine: true },
      route: "paired-engine",
    },
    { name: "the link asks for the form", facts: { ...none, wantsOwnEngine: true }, route: "own-engine-form" },
    {
      name: "a user mid-build resumes in setup",
      facts: { ...none, instances: [{ hosting: "managed" }] },
      route: "setup",
    },
    {
      name: "the link still works over the empty managed row",
      facts: { ...none, wantsOwnEngine: true, instances: [{ hosting: "managed" }] },
      route: "own-engine-form",
    },
    {
      name: "a registered instance is past all of this",
      facts: { ...none, wantsOwnEngine: true, instances: [{ clientId: "c", hosting: "external" }] },
      route: "setup",
    },
    {
      name: "a failed registration of the user's own engine gets the managed path",
      facts: { ...none, instances: [{ hosting: "external" }] },
      route: "managed",
    },
  ])("$name", ({ facts, route }) => {
    expect(onboardingRoute(facts)).toBe(route);
  });
});

describe("enginesForOnboarding", () => {
  const invited = { clientId: "c", hosting: "managed" as const, ownedByMe: false };
  const mine = { hosting: "managed" as const, ownedByMe: true };

  test.each([
    {
      name: "without the flag every engine counts",
      wants: false,
      instances: [invited, mine],
      expected: [invited, mine],
    },
    { name: "with the flag an invited engine is not theirs", wants: true, instances: [invited], expected: [] },
    { name: "with the flag their own engine still counts", wants: true, instances: [invited, mine], expected: [mine] },
  ])("$name", ({ wants, instances, expected }) => {
    expect(enginesForOnboarding(instances, wants)).toEqual(expected);
  });

  test("an invitee who asks for their own engine gets the managed path, not the invited engine's setup", () => {
    const facts = { ...none, instances: enginesForOnboarding([invited], true) };
    expect(onboardingRoute(facts)).toBe("managed");
    expect(onboardingRoute({ ...none, instances: enginesForOnboarding([invited], false) })).toBe("setup");
  });
});
