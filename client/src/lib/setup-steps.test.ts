import { describe, expect, test } from "bun:test";
import { allowedSetupStep, firstIncompleteStep, isSetupStepId } from "./setup-steps";

const nothingDone = { platformsChosenAt: null, twitchUsername: null };
const platformsChosen = { platformsChosenAt: 1, twitchUsername: null };
const allDone = { platformsChosenAt: 1, twitchUsername: "streamer" };

describe("firstIncompleteStep", () => {
  test("starts with platforms", () => {
    expect(firstIncompleteStep(nothingDone)).toBe("platforms");
  });

  test("asks for Twitch once platforms are chosen", () => {
    expect(firstIncompleteStep(platformsChosen)).toBe("twitch");
  });

  test("finishes when both required steps are done", () => {
    expect(firstIncompleteStep(allDone)).toBe("finish");
  });

  test("asks for platforms before Twitch even when Twitch is already connected", () => {
    expect(firstIncompleteStep({ platformsChosenAt: null, twitchUsername: "streamer" })).toBe("platforms");
  });
});

describe("allowedSetupStep", () => {
  test("keeps a step at or before the first incomplete one", () => {
    expect(allowedSetupStep("platforms", allDone)).toBe("platforms");
    expect(allowedSetupStep("twitch", platformsChosen)).toBe("twitch");
  });

  test("moves a step past the first incomplete one back to it", () => {
    expect(allowedSetupStep("finish", platformsChosen)).toBe("twitch");
    expect(allowedSetupStep("twitch", nothingDone)).toBe("platforms");
  });
});

describe("isSetupStepId", () => {
  test("recognizes step ids only", () => {
    expect(isSetupStepId("twitch")).toBe(true);
    expect(isSetupStepId("nope")).toBe(false);
    expect(isSetupStepId(undefined)).toBe(false);
  });
});
