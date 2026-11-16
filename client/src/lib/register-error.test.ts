import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { registerError } from "./register-error";

describe("registerError", () => {
  test("explains a rejected password without the raw message", () => {
    const result = registerError(new Error("[CONVEX A(auth:signIn)] Uncaught Error: Invalid password"));
    expect(result.kind).toBe("password");
    expect(result.message).toContain("8 characters");
  });

  test.each([
    new Error("Account foo@bar.com already exists"),
    new Error("[CONVEX A(auth:signIn)] [Request ID: abc] Server Error"),
    "boom",
  ])("points other failures at signing in: %p", (err) => {
    const result = registerError(err);
    expect(result.kind).toBe("exists-or-unknown");
    expect(result.message).not.toContain("Server Error");
    expect(result.message).toContain("sign in");
  });

  test.each([
    ["sign_up_challenge_failed", "complete the check"],
    ["sign_up_challenge_unavailable", "try again in a moment"],
  ])("explains a failed bot check (%s)", (code, says) => {
    const result = registerError(new ConvexError({ code }));
    expect(result.kind).toBe("challenge");
    expect(result.message).toContain(says);
  });
});
