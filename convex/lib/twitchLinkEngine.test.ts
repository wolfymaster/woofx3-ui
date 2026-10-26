import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  DISCONNECT_FORCED_WARNING,
  type DisconnectEffects,
  disconnectLink,
  ENGINE_UNREACHABLE,
  type EngineSyncOutcome,
  isEngineUnreachableData,
  retryEngineSyncWith,
  syncAfterConnect,
  withEngineDeadline,
} from "./twitchLinkEngine";

function effects(deleteTokenOnEngine: DisconnectEffects["deleteTokenOnEngine"]) {
  const calls: string[] = [];
  const built: DisconnectEffects = {
    deleteTokenOnEngine: deleteTokenOnEngine
      ? async () => {
          calls.push("engine");
          await deleteTokenOnEngine();
        }
      : null,
    deleteLink: async () => {
      calls.push("deleteLink");
    },
    onEngineFailure: () => {
      calls.push("logged");
    },
  };
  return { built, calls };
}

const down = () => Promise.reject(new Error("connection refused"));
const up = () => Promise.resolve();

describe("disconnectLink", () => {
  test("a reachable engine drops its token, then the row goes", async () => {
    const { built, calls } = effects(up);
    expect(await disconnectLink(built, false)).toEqual({ ok: true });
    expect(calls).toEqual(["engine", "deleteLink"]);
  });

  test("an engine failure keeps the row and refuses with engine_unreachable", async () => {
    const { built, calls } = effects(down);
    const refusal = await disconnectLink(built, false).catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(ConvexError);
    expect(isEngineUnreachableData((refusal as ConvexError<unknown>).data)).toBe(true);
    expect((refusal as ConvexError<{ code: string }>).data.code).toBe(ENGINE_UNREACHABLE);
    expect(calls).toEqual(["engine", "logged"]);
  });

  test("force deletes the row anyway and warns", async () => {
    const { built, calls } = effects(down);
    expect(await disconnectLink(built, true)).toEqual({ ok: true, warning: DISCONNECT_FORCED_WARNING });
    expect(calls).toEqual(["engine", "logged", "deleteLink"]);
  });

  test("force on a reachable engine does not warn", async () => {
    const { built } = effects(up);
    expect(await disconnectLink(built, true)).toEqual({ ok: true });
  });

  test("no registered engine deletes the row without calling out", async () => {
    const { built, calls } = effects(null);
    expect(await disconnectLink(built, false)).toEqual({ ok: true });
    expect(calls).toEqual(["deleteLink"]);
  });
});

describe("syncAfterConnect", () => {
  const cases: Array<{ name: string; outcome: EngineSyncOutcome; expected: string }> = [
    { name: "a synced engine is connected", outcome: "synced", expected: "connected" },
    { name: "a failed engine call is pending", outcome: "engine_failed", expected: "connectedPendingEngine" },
    { name: "no engine is connected", outcome: "no_engine", expected: "connected" },
  ];
  for (const { name, outcome, expected } of cases) {
    test(name, async () => {
      expect(await syncAfterConnect(async () => outcome)).toBe(expected as never);
    });
  }

  test("a sync fault propagates instead of offering a retry that cannot succeed", async () => {
    await expect(
      syncAfterConnect(() => Promise.reject(new Error("AUTH_TWITCH_ID env var is not set")))
    ).rejects.toThrow("AUTH_TWITCH_ID");
  });
});

describe("retryEngineSyncWith", () => {
  const cases: Array<{ name: string; outcome: EngineSyncOutcome; refusal: "unreachable" | "other" | null }> = [
    { name: "a synced engine succeeds", outcome: "synced", refusal: null },
    { name: "a failed engine call is engine_unreachable", outcome: "engine_failed", refusal: "unreachable" },
    { name: "no registered engine is not reported as unreachable", outcome: "no_engine", refusal: "other" },
  ];
  for (const { name, outcome, refusal } of cases) {
    test(name, async () => {
      const thrown = await retryEngineSyncWith(async () => outcome).then(
        () => null,
        (err: unknown) => err
      );
      if (refusal === null) {
        expect(thrown).toBeNull();
      } else if (refusal === "unreachable") {
        expect(thrown).toBeInstanceOf(ConvexError);
        expect(isEngineUnreachableData((thrown as ConvexError<unknown>).data)).toBe(true);
      } else {
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).not.toBeInstanceOf(ConvexError);
      }
    });
  }

  test("a sync fault is not reported as unreachable", async () => {
    const thrown = await retryEngineSyncWith(() => Promise.reject(new Error("No Twitch platform link found"))).catch(
      (err: unknown) => err
    );
    expect(thrown).not.toBeInstanceOf(ConvexError);
  });
});

describe("withEngineDeadline", () => {
  test("a call that never settles rejects, so disconnect reports engine_unreachable", async () => {
    const { built, calls } = effects(() => withEngineDeadline(() => new Promise<void>(() => {}), 10));
    const refusal = await disconnectLink(built, false).catch((err: unknown) => err);
    expect(isEngineUnreachableData((refusal as ConvexError<unknown>).data)).toBe(true);
    expect(calls).toEqual(["engine", "logged"]);
  });

  test("a call inside the deadline resolves with its value", async () => {
    expect(await withEngineDeadline(async () => 7, 1000)).toBe(7);
  });
});

describe("isEngineUnreachableData", () => {
  const cases: Array<{ name: string; data: unknown; expected: boolean }> = [
    { name: "the coded shape", data: { code: ENGINE_UNREACHABLE, message: "x" }, expected: true },
    { name: "another code", data: { code: "other", message: "x" }, expected: false },
    { name: "a plain string", data: "engine_unreachable", expected: false },
    { name: "no message", data: { code: ENGINE_UNREACHABLE }, expected: false },
    { name: "null", data: null, expected: false },
  ];
  for (const { name, data, expected } of cases) {
    test(name, () => {
      expect(isEngineUnreachableData(data)).toBe(expected);
    });
  }
});
