import { describe, expect, test } from "bun:test";
import { allowedSetupStep, firstIncompleteStep, isSetupStepId, type SetupProgress, setupRedirect } from "./setup-steps";

const nothingDone: SetupProgress = {
  platformsChosenAt: null,
  twitchUsername: null,
  twitchRequired: true,
  importChosenAt: null,
  interestsChosenAt: null,
  completedAt: null,
};
const platformsChosen: SetupProgress = { ...nothingDone, platformsChosenAt: 1 };
const twitchConnected: SetupProgress = { ...platformsChosen, twitchUsername: "streamer" };
const importChosen: SetupProgress = { ...twitchConnected, importChosenAt: 2 };
const interestsChosen: SetupProgress = { ...importChosen, interestsChosenAt: 2 };
const completed: SetupProgress = { ...interestsChosen, completedAt: 3 };

describe("firstIncompleteStep", () => {
  test("walks the steps in order", () => {
    expect(firstIncompleteStep(nothingDone)).toBe("platforms");
    expect(firstIncompleteStep(platformsChosen)).toBe("twitch");
    expect(firstIncompleteStep(twitchConnected)).toBe("import");
    expect(firstIncompleteStep(importChosen)).toBe("interests");
    expect(firstIncompleteStep(interestsChosen)).toBe("dashboard");
    expect(firstIncompleteStep(completed)).toBe("finish");
  });

  test("does not send a setup back to the import question once interests are answered", () => {
    expect(firstIncompleteStep({ ...twitchConnected, interestsChosenAt: 2 })).toBe("dashboard");
  });

  test("passes the Twitch page unconnected where Twitch is optional", () => {
    expect(firstIncompleteStep({ ...platformsChosen, twitchRequired: false })).toBe("import");
    expect(allowedSetupStep("finish", { ...platformsChosen, twitchRequired: false })).toBe("import");
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
    expect(allowedSetupStep("overlay", completed)).toBe("overlay");
  });

  test("moves a step past the first incomplete one back to it", () => {
    expect(allowedSetupStep("finish", platformsChosen)).toBe("twitch");
    expect(allowedSetupStep("twitch", nothingDone)).toBe("platforms");
    expect(allowedSetupStep("finish", interestsChosen)).toBe("dashboard");
    expect(allowedSetupStep("overlay", interestsChosen)).toBe("dashboard");
  });
});

describe("isSetupStepId", () => {
  test("recognizes step ids only", () => {
    expect(isSetupStepId("twitch")).toBe(true);
    expect(isSetupStepId("nope")).toBe(false);
    expect(isSetupStepId(undefined)).toBe(false);
  });
});

describe("setupRedirect", () => {
  test("stays on an allowed step", () => {
    expect(setupRedirect("interests", null, importChosen)).toBeNull();
    expect(setupRedirect("platforms", null, completed)).toBeNull();
  });

  test("sends a missing or too-early step to the first one still to do, replacing it in the history", () => {
    expect(setupRedirect(null, null, platformsChosen)).toEqual({ step: "twitch", replace: true });
    expect(setupRedirect("finish", null, interestsChosen)).toEqual({ step: "dashboard", replace: true });
  });

  test("waits on the finished step until the progress records it", () => {
    expect(setupRedirect("platforms", "twitch", nothingDone)).toBeNull();
    expect(setupRedirect("interests", "dashboard", importChosen)).toBeNull();
    expect(setupRedirect("dashboard", "overlay", interestsChosen)).toBeNull();
  });

  test("goes on, as a new history entry, once the progress records the finished step", () => {
    expect(setupRedirect("platforms", "twitch", platformsChosen)).toEqual({ step: "twitch", replace: false });
    expect(setupRedirect("import", "interests", importChosen)).toEqual({ step: "interests", replace: false });
    expect(setupRedirect("interests", "dashboard", interestsChosen)).toEqual({ step: "dashboard", replace: false });
    expect(setupRedirect("dashboard", "overlay", completed)).toEqual({ step: "overlay", replace: false });
    expect(setupRedirect("overlay", "finish", completed)).toEqual({ step: "finish", replace: false });
  });

  test("stays once it has arrived", () => {
    expect(setupRedirect("dashboard", "dashboard", interestsChosen)).toBeNull();
  });
});
