import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { actionErrorMessage } from "./action-error";

describe("actionErrorMessage", () => {
  test("uses a ConvexError's string data", () => {
    expect(actionErrorMessage(new ConvexError("That user is already banned."))).toBe("That user is already banned.");
  });

  test("cuts the message out of Convex's wrapper around a plain Error", () => {
    const wrapped = new Error(
      "[CONVEX A(moderation:banUser)] [Request ID: abc] Server Error\nUncaught Error: Twitch is not connected for this instance\n    at handler (../convex/moderation.ts:10:5)"
    );
    expect(actionErrorMessage(wrapped)).toBe("Twitch is not connected for this instance");
  });

  test("passes other messages through", () => {
    expect(actionErrorMessage(new Error("Network down"))).toBe("Network down");
    expect(actionErrorMessage("plain")).toBe("plain");
  });
});
