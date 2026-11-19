import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rememberReferral, takeReferral } from "./referral-capture";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("referral capture storage", () => {
  test("remembers a code once and hands it over once", () => {
    rememberReferral("?ref=abc123&next=%2F");
    expect(takeReferral()).toBe("abc123");
    expect(takeReferral()).toBeNull();
  });

  test.each([["?ref="], ["?ref=A%20B"], ["?ref=../x"], ["?other=1"], [""]])("ignores %p", (search) => {
    rememberReferral(search);
    expect(takeReferral()).toBeNull();
  });
});
