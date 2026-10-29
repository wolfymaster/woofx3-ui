import { describe, expect, test } from "bun:test";
import { generateOpaqueToken, isOpaqueToken } from "@convex/lib/oauthHandoff";
import type { ExchangeHandoffResult } from "@convex/viewerSession";
import { DEFAULT_USER_PAGES_ORIGIN, userPagesOrigin } from "./config";
import { ROLE_REFRESH_RETRY, roleRefreshRetryDelay, roleRefreshStep } from "./role-refresh";
import {
  browserViewerStorage,
  canonicalPageUrl,
  finishSignIn,
  readSignInReturn,
  type SignInFailure,
  type SignInReturn,
  signInFailureMessage,
  signInStartUrl,
  type ViewerStorage,
} from "./sign-in";

describe("userPagesOrigin", () => {
  const cases: Array<{ value: unknown; origin?: string; throws?: string }> = [
    { value: undefined, origin: DEFAULT_USER_PAGES_ORIGIN },
    { value: "https://woofx3.tv/", origin: "https://woofx3.tv" },
    { value: "https://pages.example.com/u/", origin: "https://pages.example.com" },
    { value: "http://localhost:5174", origin: "http://localhost:5174" },
    { value: "", throws: "empty" },
    { value: "   ", throws: "empty" },
    { value: "not a url", throws: "not a URL" },
    { value: "http://woofx3.tv", throws: "must be https" },
  ];
  for (const { value, origin, throws } of cases) {
    test(`${JSON.stringify(value)} ${throws ? `fails: ${throws}` : `is ${origin}`}`, () => {
      if (throws) {
        expect(() => userPagesOrigin(value)).toThrow(throws);
      } else {
        expect(userPagesOrigin(value)).toBe(origin as string);
      }
    });
  }
});

describe("signInStartUrl", () => {
  test("starts at the edge route on the user-pages origin, with the page to return to and the nonce", () => {
    const nonce = generateOpaqueToken();
    const url = new URL(signInStartUrl("https://woofx3.tv", "/u/", "https://woofx3.tv/u/wolfy?tab=a&b=1", nonce));
    expect(url.origin).toBe("https://woofx3.tv");
    expect(url.pathname).toBe("/u/_/viewer-auth/twitch/start");
    expect(url.searchParams.get("return_to")).toBe("https://woofx3.tv/u/wolfy?tab=a&b=1");
    expect(url.searchParams.get("nonce")).toBe(nonce);
    expect([...url.searchParams.keys()]).toEqual(["return_to", "nonce"]);
  });

  test("the nonce the page generates is the shape Convex accepts", () => {
    expect(isOpaqueToken(generateOpaqueToken())).toBe(true);
  });
});

describe("canonicalPageUrl", () => {
  test("is the slug's page on the user-pages origin, encoded", () => {
    expect(canonicalPageUrl("https://woofx3.tv", "/u/", "wolfy")).toBe("https://woofx3.tv/u/wolfy");
    expect(canonicalPageUrl("https://woofx3.tv", "/u/", "café")).toBe("https://woofx3.tv/u/caf%C3%A9");
  });
});

describe("readSignInReturn", () => {
  const cases: Array<{ name: string; href: string; signInReturn: SignInReturn; cleanHref: string }> = [
    {
      name: "a page with no sign-in",
      href: "https://woofx3.tv/u/wolfy?tab=a",
      signInReturn: { kind: "none" },
      cleanHref: "https://woofx3.tv/u/wolfy?tab=a",
    },
    {
      name: "a handoff code",
      href: "https://woofx3.tv/u/wolfy?tab=a&viewer_code=abc",
      signInReturn: { kind: "code", code: "abc" },
      cleanHref: "https://woofx3.tv/u/wolfy?tab=a",
    },
    {
      name: "an empty code",
      href: "https://woofx3.tv/u/wolfy?viewer_code=",
      signInReturn: { kind: "none" },
      cleanHref: "https://woofx3.tv/u/wolfy",
    },
    {
      name: "a known error",
      href: "https://woofx3.tv/u/wolfy?viewer_auth_error=rate_limited",
      signInReturn: { kind: "error", code: "rate_limited" },
      cleanHref: "https://woofx3.tv/u/wolfy",
    },
    {
      name: "an unknown error",
      href: "https://woofx3.tv/u/wolfy?viewer_auth_error=%3Cscript%3E",
      signInReturn: { kind: "error", code: null },
      cleanHref: "https://woofx3.tv/u/wolfy",
    },
    {
      name: "an error beside a code",
      href: "https://woofx3.tv/u/wolfy?viewer_code=abc&viewer_auth_error=access_denied",
      signInReturn: { kind: "error", code: "access_denied" },
      cleanHref: "https://woofx3.tv/u/wolfy",
    },
    {
      name: "a code with a hash",
      href: "https://woofx3.tv/u/wolfy?viewer_code=abc#links",
      signInReturn: { kind: "code", code: "abc" },
      cleanHref: "https://woofx3.tv/u/wolfy#links",
    },
  ];
  for (const { name, href, signInReturn, cleanHref } of cases) {
    test(name, () => {
      expect(readSignInReturn(href)).toEqual({ signInReturn, cleanHref });
    });
  }
});

describe("signInFailureMessage", () => {
  const failures: SignInFailure[] = [
    "access_denied",
    "missing_params",
    "token_exchange_failed",
    "profile_fetch_failed",
    "rate_limited",
    "handoff_invalid",
    "handoff_expired",
    "nonce_mismatch",
    "nonce_missing",
    "unknown",
    "exchange_failed",
  ];
  for (const failure of failures) {
    test(`${failure} has a sentence for the viewer`, () => {
      const message = signInFailureMessage(failure);
      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).not.toContain("_");
    });
  }

  test("rate_limited asks the viewer to wait", () => {
    expect(signInFailureMessage("rate_limited")).toContain("Wait a minute");
  });
});

function memoryStorage(initial: { nonce?: string; token?: string } = {}): ViewerStorage & {
  nonce: string | null;
  token: string | null;
} {
  const store = {
    nonce: initial.nonce ?? null,
    token: initial.token ?? null,
    takeNonce: () => {
      const nonce = store.nonce;
      store.nonce = null;
      return nonce;
    },
    putNonce: (nonce: string) => {
      store.nonce = nonce;
    },
    sessionToken: () => store.token,
    putSessionToken: (token: string) => {
      store.token = token;
    },
    clearSessionToken: () => {
      store.token = null;
    },
  };
  return store;
}

describe("finishSignIn", () => {
  const ok: ExchangeHandoffResult = { ok: true, sessionToken: "session", expiresAt: 1 };

  test("does nothing for a page with no sign-in", async () => {
    const storage = memoryStorage({ nonce: "n" });
    expect(await finishSignIn({ kind: "none" }, storage, async () => ok)).toBeNull();
    expect(storage.nonce).toBe("n");
  });

  test("exchanges the code with this tab's nonce, forgets the nonce and keeps the session", async () => {
    const storage = memoryStorage({ nonce: "n" });
    const calls: unknown[] = [];
    const outcome = await finishSignIn({ kind: "code", code: "c" }, storage, async (args) => {
      calls.push(args);
      return ok;
    });
    expect(outcome).toEqual({ kind: "signed_in", sessionToken: "session" });
    expect(calls).toEqual([{ code: "c", nonce: "n" }]);
    expect(storage.nonce).toBeNull();
    expect(storage.token).toBe("session");
  });

  test("refuses a code this tab holds no nonce for, without asking Convex", async () => {
    const storage = memoryStorage();
    let asked = false;
    const outcome = await finishSignIn({ kind: "code", code: "c" }, storage, async () => {
      asked = true;
      return ok;
    });
    expect(outcome).toEqual({ kind: "failed", failure: "nonce_missing" });
    expect(asked).toBe(false);
  });

  test("passes on the exchange's refusal and stores nothing", async () => {
    const storage = memoryStorage({ nonce: "n" });
    const outcome = await finishSignIn({ kind: "code", code: "c" }, storage, async () => ({
      ok: false,
      error: "handoff_expired",
    }));
    expect(outcome).toEqual({ kind: "failed", failure: "handoff_expired" });
    expect(storage.token).toBeNull();
  });

  test("an exchange that throws is a failure, not a sign-in", async () => {
    const storage = memoryStorage({ nonce: "n" });
    const outcome = await finishSignIn({ kind: "code", code: "c" }, storage, async () => {
      throw new Error("offline");
    });
    expect(outcome).toEqual({ kind: "failed", failure: "exchange_failed" });
  });

  test("an error from the callback forgets the nonce", async () => {
    const storage = memoryStorage({ nonce: "n" });
    const known = await finishSignIn({ kind: "error", code: "rate_limited" }, storage, async () => ok);
    expect(known).toEqual({ kind: "failed", failure: "rate_limited" });
    expect(storage.nonce).toBeNull();
    const unknown = await finishSignIn({ kind: "error", code: null }, memoryStorage(), async () => ok);
    expect(unknown).toEqual({ kind: "failed", failure: "unknown" });
  });
});

class MapStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

class BlockedStorage extends MapStorage {
  override getItem(): string | null {
    throw new Error("blocked");
  }
  override setItem() {
    throw new Error("blocked");
  }
  override removeItem() {
    throw new Error("blocked");
  }
}

describe("browserViewerStorage", () => {
  test("keeps the nonce for the tab, once, and the session token for the origin", () => {
    const session = new MapStorage();
    const local = new MapStorage();
    const storage = browserViewerStorage(session, local);
    storage.putNonce("n");
    storage.putSessionToken("t");
    expect(session.length).toBe(1);
    expect(local.length).toBe(1);
    expect(storage.takeNonce()).toBe("n");
    expect(storage.takeNonce()).toBeNull();
    expect(storage.sessionToken()).toBe("t");
    storage.clearSessionToken();
    expect(storage.sessionToken()).toBeNull();
  });

  test("reads as signed out where storage is blocked or missing", () => {
    for (const storage of [
      browserViewerStorage(new BlockedStorage(), new BlockedStorage()),
      browserViewerStorage(null, null),
    ]) {
      storage.putNonce("n");
      storage.putSessionToken("t");
      expect(storage.takeNonce()).toBeNull();
      expect(storage.sessionToken()).toBeNull();
    }
  });
});

describe("roleRefreshStep", () => {
  const cases: Array<[Parameters<typeof roleRefreshStep>[0], ReturnType<typeof roleRefreshStep>]> = [
    [{ ok: true, follower: true, subscriberTier: null, checkedAt: 1 }, "settled"],
    [{ ok: false, error: "unavailable" }, "retry"],
    [{ ok: false, error: "rate_limited" }, "retry"],
    ["error", "retry"],
    [{ ok: false, error: "reauth_required" }, "reauth"],
    [{ ok: false, error: "not_signed_in" }, "signed_out"],
    [{ ok: false, error: "page_not_found" }, "stop"],
    [{ ok: false, error: "broadcaster_not_linked" }, "stop"],
    [{ ok: false, error: "platform_mismatch" }, "stop"],
  ];
  for (const [result, step] of cases) {
    test(`${typeof result === "string" ? result : result.ok ? "ok" : result.error} is ${step}`, () => {
      expect(roleRefreshStep(result)).toBe(step);
    });
  }
});

describe("roleRefreshRetryDelay", () => {
  const config = { baseMs: 1000, maxMs: 8000 };

  test("doubles from the base and stays at the cap", () => {
    const noJitter = () => 0;
    expect([0, 1, 2, 3, 4, 10].map((attempt) => roleRefreshRetryDelay(attempt, config, noJitter))).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });

  test("jitter takes up to half off, never adds", () => {
    expect(roleRefreshRetryDelay(0, config, () => 0.999)).toBe(500);
    expect(roleRefreshRetryDelay(3, config, () => 0.5)).toBe(6000);
  });

  test("the page's retries start at thirty seconds and stop growing at five minutes", () => {
    expect(roleRefreshRetryDelay(0, ROLE_REFRESH_RETRY, () => 0)).toBe(30_000);
    expect(roleRefreshRetryDelay(20, ROLE_REFRESH_RETRY, () => 0)).toBe(300_000);
  });
});
