import { describe, expect, test } from "bun:test";
import { sessionHintCookie } from "./session-hint";

describe("sessionHintCookie", () => {
  test("sets the cookie for the apex and its subdomains", () => {
    expect(sessionHintCookie("woofx3.tv", "woofx3.tv", true)).toContain("woofx3_session=1;");
    expect(sessionHintCookie("stream.woofx3.tv", "woofx3.tv", true)).toContain("domain=.woofx3.tv");
  });
  test("clears the cookie when signed out", () => {
    expect(sessionHintCookie("stream.woofx3.tv", "woofx3.tv", false)).toContain("max-age=0");
  });
  test("does nothing on a host the marketing site cannot read", () => {
    expect(sessionHintCookie("pr-1.preview.dev", "woofx3.tv", true)).toBeNull();
    expect(sessionHintCookie("notwoofx3.tv", "woofx3.tv", true)).toBeNull();
  });
});
