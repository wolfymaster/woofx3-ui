import { describe, expect, test } from "bun:test";
import { hashOpaqueToken, isOpaqueToken } from "@convex/lib/oauthHandoff";
import type { DesktopSignInClaim } from "@convex/lib/twitchSignIn";
import { FakeClock } from "@/lib/engine-session/testing/FakeClock";
import { RecordingLogger } from "@/lib/engine-session/testing/RecordingLogger";
import { waitFor } from "@/lib/engine-session/testing/wait-for";
import {
  DESKTOP_SIGN_IN_POLL_MS,
  DESKTOP_SIGN_IN_TIME_LIMIT_MS,
  type DesktopSignInEnd,
  startDesktopTwitchSignIn,
} from "./twitch-sign-in";

type Answer = DesktopSignInClaim | Error;

/** A host and Convex that record what the sign-in asks of them and answer from a script. */
class FakeSignIn {
  readonly clock = new FakeClock();
  readonly logger = new RecordingLogger();
  readonly opened: string[] = [];
  readonly claimed: string[] = [];
  readonly signedIn: { token: string; nonce: string }[] = [];
  readonly ends: DesktopSignInEnd[] = [];
  /** Answered in order; once spent, every claim is pending. */
  answers: Answer[] = [];
  openFails: Error | null = null;
  signInAccepted = true;

  start() {
    return startDesktopTwitchSignIn(
      {
        clock: this.clock,
        logger: this.logger,
        openBrowser: async (nonceHash) => {
          if (this.openFails !== null) {
            throw this.openFails;
          }
          this.opened.push(nonceHash);
        },
        claim: async (nonce) => {
          this.claimed.push(nonce);
          const answer = this.answers.shift() ?? { status: "pending" };
          if (answer instanceof Error) {
            throw answer;
          }
          return answer;
        },
        signIn: async (token, nonce) => {
          this.signedIn.push({ token, nonce });
          return this.signInAccepted;
        },
      },
      (end) => this.ends.push(end)
    );
  }

  async opening(): Promise<void> {
    await waitFor(() => this.opened.length > 0 || this.ends.length > 0, "the browser to open");
  }

  /** Moves past the next ask and lets its answer land. */
  async nextAsk(): Promise<void> {
    const before = this.claimed.length;
    this.clock.advance(DESKTOP_SIGN_IN_POLL_MS);
    await waitFor(() => this.claimed.length > before, "a claim");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("startDesktopTwitchSignIn", () => {
  test("opens the browser with only the nonce's hash, and signs in with the token and nonce once claimed", async () => {
    const fake = new FakeSignIn();
    fake.answers = [{ status: "pending" }, { status: "signed_in", token: "pending-token" }];
    fake.start();
    await fake.opening();

    await fake.nextAsk();
    expect(fake.ends).toEqual([]);
    await fake.nextAsk();
    await waitFor(() => fake.ends.length > 0, "the end");

    const nonce = fake.claimed[0];
    expect(isOpaqueToken(nonce)).toBe(true);
    expect(fake.opened).toEqual([await hashOpaqueToken(nonce)]);
    expect(fake.claimed).toEqual([nonce, nonce]);
    expect(fake.signedIn).toEqual([{ token: "pending-token", nonce }]);
    expect(fake.ends).toEqual([{ kind: "signed_in" }]);
  });

  test("asks nothing before the first interval", async () => {
    const fake = new FakeSignIn();
    fake.start();
    await fake.opening();
    fake.clock.advance(DESKTOP_SIGN_IN_POLL_MS - 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.claimed).toEqual([]);
  });

  const endings: [string, Answer, DesktopSignInEnd][] = [
    [
      "reports a refused sign-in",
      { status: "failed", error: "access_denied" },
      { kind: "failed", error: "access_denied" },
    ],
    ["reports an outcome claimed too late as timed out", { status: "expired" }, { kind: "timed_out" }],
  ];
  for (const [name, answer, expected] of endings) {
    test(name, async () => {
      const fake = new FakeSignIn();
      fake.answers = [answer];
      fake.start();
      await fake.opening();
      await fake.nextAsk();
      expect(fake.ends).toEqual([expected]);
      expect(fake.signedIn).toEqual([]);
    });
  }

  test("reports a token Convex Auth did not accept as a failed sign-in", async () => {
    const fake = new FakeSignIn();
    fake.answers = [{ status: "signed_in", token: "pending-token" }];
    fake.signInAccepted = false;
    fake.start();
    await fake.opening();
    await fake.nextAsk();
    await waitFor(() => fake.ends.length > 0, "the end");
    expect(fake.ends).toEqual([{ kind: "failed", error: "sign_in_failed" }]);
  });

  test("keeps asking after a claim that could not be made, and logs it", async () => {
    const fake = new FakeSignIn();
    fake.answers = [new Error("Connection lost"), { status: "failed", error: "token_exchange_failed" }];
    fake.start();
    await fake.opening();
    await fake.nextAsk();
    expect(fake.ends).toEqual([]);
    expect(fake.logger.entries.map((entry) => entry.level)).toEqual(["warn"]);
    await fake.nextAsk();
    expect(fake.ends).toEqual([{ kind: "failed", error: "token_exchange_failed" }]);
  });

  test("gives up once the sign-in's state can no longer be finished", async () => {
    const fake = new FakeSignIn();
    fake.start();
    await fake.opening();
    const asks = Math.ceil(DESKTOP_SIGN_IN_TIME_LIMIT_MS / DESKTOP_SIGN_IN_POLL_MS);
    for (let i = 0; i < asks; i += 1) {
      await fake.nextAsk();
    }
    expect(fake.ends).toEqual([{ kind: "timed_out" }]);
    fake.clock.advance(DESKTOP_SIGN_IN_POLL_MS * 10);
    expect(fake.claimed.length).toBe(asks);
  });

  test("stops asking when cancelled, and never reports an end", async () => {
    const fake = new FakeSignIn();
    const cancel = fake.start();
    await fake.opening();
    await fake.nextAsk();
    cancel();
    fake.clock.advance(DESKTOP_SIGN_IN_POLL_MS * 10);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.claimed.length).toBe(1);
    expect(fake.ends).toEqual([]);
  });

  test("ignores an answer that lands after a cancel", async () => {
    const fake = new FakeSignIn();
    fake.answers = [{ status: "signed_in", token: "pending-token" }];
    const cancel = fake.start();
    await fake.opening();
    fake.clock.advance(DESKTOP_SIGN_IN_POLL_MS);
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.signedIn).toEqual([]);
    expect(fake.ends).toEqual([]);
  });

  test("reports a browser that would not open, and asks nothing", async () => {
    const fake = new FakeSignIn();
    fake.openFails = new Error("no browser");
    fake.start();
    await fake.opening();
    fake.clock.advance(DESKTOP_SIGN_IN_POLL_MS * 2);
    expect(fake.ends).toEqual([{ kind: "browser_not_opened", reason: "no browser" }]);
    expect(fake.claimed).toEqual([]);
  });
});
