import { describe, expect, test } from "bun:test";
import { safeRelativePath } from "@convex/lib/safeRedirect";
import { afterRegisterPath } from "./auth-next-path";
import { twitchSignInStartUrl } from "./twitch-sign-in";

describe("Twitch sign-up from the register page", () => {
  const sponsor = "/sponsor/start?amountCents=25000&interval=month";

  test.each([
    { name: "with no next lands on onboarding", search: "", lands: "/auth/onboarding" },
    { name: "with a sponsor next lands there", search: `?next=${encodeURIComponent(sponsor)}`, lands: sponsor },
  ])("$name", ({ search, lands }) => {
    const start = new URL(twitchSignInStartUrl("https://site.test", afterRegisterPath(search), "nonce"));
    // Convex stores the target clamped, and the callback page clamps it again before navigating.
    const stored = safeRelativePath(start.searchParams.get("redirect_to"));
    expect(safeRelativePath(stored)).toBe(lands);
  });
});
