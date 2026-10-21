import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  DISCONNECT_FORCED_WARNING,
  type DisconnectEffects,
  disconnectLink,
  ENGINE_UNREACHABLE,
  isEngineUnreachableData,
  syncAfterConnect,
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
  const cases: Array<{
    name: string;
    hasEngine: boolean;
    sync: () => Promise<void>;
    expected: string;
    failures: number;
  }> = [
    { name: "a synced engine is connected", hasEngine: true, sync: up, expected: "connected", failures: 0 },
    { name: "a failed sync is pending", hasEngine: true, sync: down, expected: "connectedPendingEngine", failures: 1 },
    {
      name: "no engine is connected without syncing",
      hasEngine: false,
      sync: down,
      expected: "connected",
      failures: 0,
    },
  ];
  for (const { name, hasEngine, sync, expected, failures } of cases) {
    test(name, async () => {
      let failed = 0;
      expect(await syncAfterConnect(hasEngine, sync, () => failed++)).toBe(expected as never);
      expect(failed).toBe(failures);
    });
  }
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
