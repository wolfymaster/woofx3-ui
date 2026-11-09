import { describe, expect, test } from "bun:test";
import { acceptRefusalMessage } from "./accept-invite-outcome";

describe("acceptRefusalMessage", () => {
  test("a joined user gets no refusal", () => {
    expect(acceptRefusalMessage({ status: "already_member", instanceId: "i" as never })).toBeNull();
  });

  test("a wrong account is told which account to sign in with", () => {
    const message = "Sign in with the email address this invitation was sent to";
    expect(acceptRefusalMessage({ status: "wrong_account", message })).toBe(message);
  });

  test.each([
    ["already_accepted", "already been used"],
    ["expired", "expired"],
    ["revoked", "cancelled"],
    ["not_found", "could not find"],
    ["engine_gone", "deleted"],
    ["seats_full", "no free seats"],
  ] as const)("%s says so in plain words", (status, words) => {
    expect(acceptRefusalMessage({ status })).toContain(words);
  });
});
