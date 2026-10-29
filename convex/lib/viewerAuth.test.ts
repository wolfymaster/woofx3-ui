import { describe, expect, test } from "bun:test";
import {
  allowedReturnOrigins,
  VIEWER_HANDOFF_TTL_MS,
  VIEWER_LOGIN_STATE_TTL_MS,
  VIEWER_ROLES_TTL_MS,
  viewerHandoffRefusal,
  viewerLoginStateUsable,
  viewerReturnTarget,
  viewerReturnUrl,
  viewerRolesFresh,
  viewerSessionLive,
} from "./viewerAuth";

const ALLOWED = ["https://woofx3.tv"];
const NOW = 1_800_000_000_000;
const NONCE_HASH = "a".repeat(64);

describe("allowedReturnOrigins", () => {
  test("is the origin of the configured public base", () => {
    expect(allowedReturnOrigins("https://woofx3.tv/u")).toEqual(["https://woofx3.tv"]);
  });

  test("refuses to run without a configured base", () => {
    expect(() => allowedReturnOrigins(undefined)).toThrow("USER_PAGES_BASE_URL is not set");
    expect(() => allowedReturnOrigins("")).toThrow("USER_PAGES_BASE_URL is not set");
  });

  test("refuses a plain-http base other than localhost", () => {
    expect(() => allowedReturnOrigins("http://woofx3.tv")).toThrow("must be https");
    expect(allowedReturnOrigins("http://localhost:5173")).toEqual(["http://localhost:5173"]);
  });
});

describe("viewerReturnTarget", () => {
  const cases: [string, string | null, ReturnType<typeof viewerReturnTarget>][] = [
    [
      "a page on the allowed origin",
      "https://woofx3.tv/u/wolfy?tab=x",
      { origin: "https://woofx3.tv", path: "/u/wolfy?tab=x" },
    ],
    ["the bare origin", "https://woofx3.tv", { origin: "https://woofx3.tv", path: "/" }],
    ["another origin", "https://evil.example/u/wolfy", null],
    ["a lookalike subdomain", "https://woofx3.tv.evil.example/", null],
    ["the allowed host over http", "http://woofx3.tv/u/wolfy", null],
    ["credentials in the URL", "https://user:pass@woofx3.tv/u/wolfy", null],
    ["a relative path", "/u/wolfy", null],
    ["a javascript URL", "javascript:alert(1)", null],
    ["nothing", null, null],
    ["an empty value", "", null],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(viewerReturnTarget(input, ALLOWED)).toEqual(expected);
    });
  }

  test("drops the fragment and clamps dot segments", () => {
    expect(viewerReturnTarget("https://woofx3.tv/u/../u/wolfy#top", ALLOWED)).toEqual({
      origin: "https://woofx3.tv",
      path: "/u/wolfy",
    });
  });
});

describe("viewerReturnUrl", () => {
  const target = { origin: "https://woofx3.tv", path: "/u/wolfy?tab=x&viewer_auth_error=old" };

  test("adds the handoff code and drops a stale error", () => {
    expect(viewerReturnUrl(target, { code: "abc" })).toBe("https://woofx3.tv/u/wolfy?tab=x&viewer_code=abc");
  });

  test("adds an error code", () => {
    expect(viewerReturnUrl(target, { error: "access_denied" })).toBe(
      "https://woofx3.tv/u/wolfy?tab=x&viewer_auth_error=access_denied"
    );
  });
});

describe("viewerLoginStateUsable", () => {
  test("refuses a state with no row, which is what a replay finds", () => {
    expect(viewerLoginStateUsable(null, NOW)).toBe(false);
  });

  test("accepts a state up to its TTL and refuses it after", () => {
    expect(viewerLoginStateUsable({ createdAt: NOW - VIEWER_LOGIN_STATE_TTL_MS }, NOW)).toBe(true);
    expect(viewerLoginStateUsable({ createdAt: NOW - VIEWER_LOGIN_STATE_TTL_MS - 1 }, NOW)).toBe(false);
  });
});

describe("viewerHandoffRefusal", () => {
  const row = { createdAt: NOW, nonceHash: NONCE_HASH };

  test("allows a fresh handoff presented with its nonce", () => {
    expect(viewerHandoffRefusal(row, NONCE_HASH, NOW)).toBeNull();
  });

  test("refuses a code with no row, which is what a replay finds", () => {
    expect(viewerHandoffRefusal(null, NONCE_HASH, NOW)).toBe("handoff_invalid");
  });

  test("refuses an expired handoff", () => {
    expect(viewerHandoffRefusal({ ...row, createdAt: NOW - VIEWER_HANDOFF_TTL_MS - 1 }, NONCE_HASH, NOW)).toBe(
      "handoff_expired"
    );
  });

  test("refuses a handoff presented with another nonce", () => {
    expect(viewerHandoffRefusal(row, "b".repeat(64), NOW)).toBe("nonce_mismatch");
  });
});

describe("viewerSessionLive", () => {
  test("is live until expiresAt and not at or after it", () => {
    expect(viewerSessionLive({ expiresAt: NOW + 1 }, NOW)).toBe(true);
    expect(viewerSessionLive({ expiresAt: NOW }, NOW)).toBe(false);
    expect(viewerSessionLive(null, NOW)).toBe(false);
  });
});

describe("viewerRolesFresh", () => {
  test("trusts roles checked within the TTL and not after", () => {
    expect(viewerRolesFresh({ checkedAt: NOW - VIEWER_ROLES_TTL_MS + 1 }, NOW)).toBe(true);
    expect(viewerRolesFresh({ checkedAt: NOW - VIEWER_ROLES_TTL_MS }, NOW)).toBe(false);
    expect(viewerRolesFresh(null, NOW)).toBe(false);
  });
});
