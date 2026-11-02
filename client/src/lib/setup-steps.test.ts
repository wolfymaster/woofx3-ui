import { describe, expect, test } from "bun:test";
import { allowedSetupStep, firstIncompleteStep, isSetupStepId, type SetupProgress, setupRedirect } from "./setup-steps";

const fresh: SetupProgress = { twitchUsername: null, twitchRequired: true, usernameNeeded: false, completedAt: null };
const connected: SetupProgress = { ...fresh, twitchUsername: "streamer", completedAt: 1 };
const skipped: SetupProgress = { ...fresh, twitchRequired: false, completedAt: 1 };

describe("firstIncompleteStep", () => {
  test.each<{ name: string; progress: SetupProgress; step: "connect" | "overlay" }>([
    { name: "a new user connects", progress: fresh, step: "connect" },
    { name: "a connected user is on the overlay", progress: connected, step: "overlay" },
    { name: "a preview that skipped is on the overlay", progress: skipped, step: "overlay" },
    { name: "a link alone does not finish setup", progress: { ...fresh, twitchUsername: "streamer" }, step: "connect" },
    {
      name: "a username still needed holds connect",
      progress: { ...connected, usernameNeeded: true },
      step: "connect",
    },
    { name: "a lost link goes back to connect", progress: { ...connected, twitchUsername: null }, step: "connect" },
  ])("$name", ({ progress, step }) => {
    expect(firstIncompleteStep(progress)).toBe(step);
  });
});

describe("allowedSetupStep", () => {
  test("nothing comes before connecting", () => {
    expect(allowedSetupStep("overlay", fresh)).toBe("connect");
    expect(allowedSetupStep("finish", fresh)).toBe("connect");
  });

  test("the connect page moves on once it is done", () => {
    expect(allowedSetupStep("connect", connected)).toBe("overlay");
  });

  test("later pages stay where they are, so a refresh keeps the place", () => {
    expect(allowedSetupStep("overlay", connected)).toBe("overlay");
    expect(allowedSetupStep("finish", connected)).toBe("finish");
  });
});

describe("isSetupStepId", () => {
  test("knows the steps and no others", () => {
    expect(isSetupStepId("connect")).toBe(true);
    expect(isSetupStepId("twitch")).toBe(false);
    expect(isSetupStepId(undefined)).toBe(false);
  });
});

describe("setupRedirect", () => {
  test("a retired page's URL, read as no step, lands where the user belongs", () => {
    expect(setupRedirect(null, null, fresh)).toEqual({ step: "connect", replace: true });
    expect(setupRedirect(null, null, connected)).toEqual({ step: "overlay", replace: true });
  });

  test("returning from Twitch moves on with no click, leaving no history entry", () => {
    expect(setupRedirect("connect", null, connected)).toEqual({ step: "overlay", replace: true });
  });

  test("stays on an allowed page", () => {
    expect(setupRedirect("connect", null, fresh)).toBeNull();
    expect(setupRedirect("overlay", null, connected)).toBeNull();
  });

  test("a finished page goes on once progress allows it", () => {
    expect(setupRedirect("overlay", "finish", connected)).toEqual({ step: "finish", replace: false });
    expect(setupRedirect("connect", "overlay", fresh)).toBeNull();
  });
});
