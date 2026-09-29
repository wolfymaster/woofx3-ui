import { describe, expect, test } from "bun:test";
import {
  dismissReconnect,
  isReconnectDismissed,
  reconnectReturnPath,
  twitchReconnectMessage,
} from "./twitch-scope-banner";

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
        { label: "Clips", optional: false, missingScopes: ["clips:edit"] },
        { label: "Pinned messages", optional: false, missingScopes: ["moderator:manage:chat_messages"] },
      ],
      optionalMissing: [
        { label: "Moderation: chat modes", optional: true, missingScopes: ["moderator:manage:chat_settings"] },
      ],
    });
    expect(message).toContain("Clips, Pinned messages");
    expect(message).not.toContain("chat modes");
  });

  test("says nothing when only optional capabilities are missing", () => {
    const optionalMissing = [
      { label: "Moderation: chat modes", optional: true, missingScopes: ["moderator:manage:chat_settings"] },
    ];
    expect(twitchReconnectMessage({ state: "ok", optionalMissing })).toBeNull();
  });

  test("explains a revoked link", () => {
    expect(twitchReconnectMessage({ state: "revoked" })).toContain("no longer accepts");
  });

  test("says nothing for a healthy or absent link", () => {
    expect(twitchReconnectMessage({ state: "ok", optionalMissing: [] })).toBeNull();
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

  test("no storage at all reads as not dismissed", () => {
    expect(() => dismissReconnect(null, "a", "revoked")).not.toThrow();
    expect(isReconnectDismissed(null, "a", "revoked")).toBe(false);
  });
});

describe("reconnectReturnPath", () => {
  test("keeps the query string", () => {
    expect(reconnectReturnPath("/settings", "tab=integrations")).toBe("/settings?tab=integrations");
    expect(reconnectReturnPath("/settings", "?tab=integrations")).toBe("/settings?tab=integrations");
  });

  test("a bare path stays bare", () => {
    expect(reconnectReturnPath("/stream/alerts", "")).toBe("/stream/alerts");
  });
});
