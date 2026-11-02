import { describe, expect, test } from "bun:test";
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
});
