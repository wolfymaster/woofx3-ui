import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { NO_SLUG_MESSAGE, NOT_ENTITLED_MESSAGE } from "@/lib/user-page-publishing";
import { pageFailure, userPageRefusalOf } from "@/lib/user-page-refusal";

const problems = [{ path: "theme.banner.url", message: "URL must start with https://" }];

describe("userPageRefusalOf", () => {
  test("reads each refusal the server sends", () => {
    for (const code of ["stale_draft", "no_slug", "not_entitled"] as const) {
      expect(userPageRefusalOf(new ConvexError({ code, message: "m" }))).toEqual({ code, message: "m" });
    }
    expect(userPageRefusalOf(new ConvexError({ code: "invalid_content", message: "m", problems }))).toEqual({
      code: "invalid_content",
      message: "m",
      problems,
    });
  });

  test("is null for anything else", () => {
    expect(userPageRefusalOf(new Error("boom"))).toBeNull();
    expect(userPageRefusalOf(new ConvexError("a sentence"))).toBeNull();
    expect(userPageRefusalOf(new ConvexError({ code: "teapot", message: "m" }))).toBeNull();
    expect(userPageRefusalOf(new ConvexError({ code: "invalid_content", message: "m" }))).toBeNull();
  });
});

describe("pageFailure", () => {
  test("invalid content carries its problems to show at their fields", () => {
    const failure = pageFailure(new ConvexError({ code: "invalid_content", message: "m", problems }));
    expect(failure.kind).toBe("problems");
    expect(failure.kind === "problems" && failure.problems).toEqual(problems);
  });

  test("a stale draft asks for a reload", () => {
    expect(pageFailure(new ConvexError({ code: "stale_draft", message: "m" })).kind).toBe("stale");
  });

  test("no address and no entitlement say what they mean", () => {
    expect(pageFailure(new ConvexError({ code: "no_slug", message: "m" }))).toEqual({
      kind: "message",
      message: NO_SLUG_MESSAGE,
    });
    expect(pageFailure(new ConvexError({ code: "not_entitled", message: "m" }))).toEqual({
      kind: "message",
      message: NOT_ENTITLED_MESSAGE,
    });
  });

  test("an unexplained error passes its message through", () => {
    expect(pageFailure(new Error("Uncaught Error: Not a member of this instance"))).toEqual({
      kind: "message",
      message: "Not a member of this instance",
    });
  });
});
