import { describe, expect, test } from "bun:test";
import { twitchConnection } from "./platform-status";

describe("twitchConnection", () => {
  test("an instance with no link is disconnected", () => {
    expect(twitchConnection({ state: "unlinked" }, undefined).state).toBe("disconnected");
  });

  test("a link Twitch has revoked is disconnected", () => {
    expect(twitchConnection({ state: "revoked" }, "wolfy").state).toBe("disconnected");
  });

  test("a link missing required scopes is degraded and names what is missing", () => {
    const connection = twitchConnection(
      {
        state: "missing",
        missing: [{ label: "Clips", optional: false, missingScopes: ["clips:edit"] }],
        optionalMissing: [],
      },
      "wolfy"
    );
    expect(connection).toEqual({ state: "degraded", detail: "Missing permission for: Clips" });
  });

  test("a healthy link is connected and names the account", () => {
    const connection = twitchConnection({ state: "ok", optionalMissing: [] }, "wolfy");
    expect(connection).toEqual({ state: "connected", detail: "Connected as @wolfy" });
  });
});
