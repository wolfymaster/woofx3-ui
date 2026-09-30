import { describe, expect, test } from "bun:test";
import { allowedSetupStep, firstIncompleteStep, isSetupStepId, type SetupProgress } from "./setup-steps";

const nothingDone: SetupProgress = {
  platformsChosenAt: null,
  twitchUsername: null,
  interestsChosenAt: null,
  completedAt: null,
};
const platformsChosen: SetupProgress = { ...nothingDone, platformsChosenAt: 1 };
const twitchConnected: SetupProgress = { ...platformsChosen, twitchUsername: "streamer" };
const interestsChosen: SetupProgress = { ...twitchConnected, interestsChosenAt: 2 };
const completed: SetupProgress = { ...interestsChosen, completedAt: 3 };

describe("firstIncompleteStep", () => {
  test("walks the steps in order", () => {
    expect(firstIncompleteStep(nothingDone)).toBe("platforms");
    expect(firstIncompleteStep(platformsChosen)).toBe("twitch");
    expect(firstIncompleteStep(twitchConnected)).toBe("interests");
    expect(firstIncompleteStep(interestsChosen)).toBe("dashboard");
    expect(firstIncompleteStep(completed)).toBe("finish");
  });

  test("asks for platforms before Twitch even when Twitch is already connected", () => {
    expect(firstIncompleteStep({ ...nothingDone, twitchUsername: "streamer" })).toBe("platforms");
  });
});

describe("allowedSetupStep", () => {
  test("keeps a step at or before the first incomplete one", () => {
    expect(allowedSetupStep("platforms", completed)).toBe("platforms");
    expect(allowedSetupStep("twitch", platformsChosen)).toBe("twitch");
    expect(allowedSetupStep("interests", completed)).toBe("interests");
  });

  test("moves a step past the first incomplete one back to it", () => {
    expect(allowedSetupStep("finish", platformsChosen)).toBe("twitch");
    expect(allowedSetupStep("twitch", nothingDone)).toBe("platforms");
    expect(allowedSetupStep("finish", interestsChosen)).toBe("dashboard");
  });
});

describe("isSetupStepId", () => {
  test("recognizes step ids only", () => {
    expect(isSetupStepId("twitch")).toBe(true);
    expect(isSetupStepId("nope")).toBe(false);
    expect(isSetupStepId(undefined)).toBe(false);
  });
});
