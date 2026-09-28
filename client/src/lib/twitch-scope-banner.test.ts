import { describe, expect, test } from "bun:test";
import { dismissReconnect, isReconnectDismissed, twitchReconnectMessage } from "./twitch-scope-banner";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("twitchReconnectMessage", () => {
  test("lists the missing capabilities by name", () => {
    const message = twitchReconnectMessage({
      state: "missing",
      missing: [
        { label: "Clips", missingScopes: ["clips:edit"] },
        { label: "Pinned messages", missingScopes: ["moderator:manage:chat_messages"] },
      ],
    });
    expect(message).toContain("Clips, Pinned messages");
  });

  test("explains a revoked link", () => {
    expect(twitchReconnectMessage({ state: "revoked" })).toContain("no longer accepts");
  });

  test("says nothing for a healthy or absent link", () => {
    expect(twitchReconnectMessage({ state: "ok" })).toBeNull();
    expect(twitchReconnectMessage({ state: "unlinked" })).toBeNull();
  });
});

describe("reconnect dismissal", () => {
  test("remembers the dismissed gap per instance", () => {
    const storage = memoryStorage();
    dismissReconnect(storage, "a", "missing:clips:edit");
    expect(isReconnectDismissed(storage, "a", "missing:clips:edit")).toBe(true);
    expect(isReconnectDismissed(storage, "b", "missing:clips:edit")).toBe(false);
  });

  test("a different gap shows again", () => {
    const storage = memoryStorage();
    dismissReconnect(storage, "a", "missing:clips:edit");
    expect(isReconnectDismissed(storage, "a", "revoked")).toBe(false);
  });

  test("storage that throws reads as not dismissed", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => dismissReconnect(broken, "a", "revoked")).not.toThrow();
    expect(isReconnectDismissed(broken, "a", "revoked")).toBe(false);
  });
});
