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
    sync: () => Promise<EngineSyncOutcome>;
    expected: string;
    failures: number;
  }> = [
    { name: "a synced engine is connected", sync: async () => "synced", expected: "connected", failures: 0 },
    { name: "a failed sync is pending", sync: down, expected: "connectedPendingEngine", failures: 1 },
    { name: "no engine is connected", sync: async () => "no_engine", expected: "connected", failures: 0 },
  ];
  for (const { name, sync, expected, failures } of cases) {
    test(name, async () => {
      let failed = 0;
      expect(await syncAfterConnect(sync, () => failed++)).toBe(expected as never);
      expect(failed).toBe(failures);
    });
  }
});

describe("retryEngineSyncWith", () => {
  const cases: Array<{
    name: string;
    hasLink: boolean;
    sync: () => Promise<EngineSyncOutcome>;
    refusal: "unreachable" | "other" | null;
    failures: number;
  }> = [
    { name: "a synced engine succeeds", hasLink: true, sync: async () => "synced", refusal: null, failures: 0 },
    {
      name: "a failed engine call is engine_unreachable",
      hasLink: true,
      sync: down,
      refusal: "unreachable",
      failures: 1,
    },
    {
      name: "a missing link is not reported as unreachable",
      hasLink: false,
      sync: down,
      refusal: "other",
      failures: 0,
    },
    {
      name: "no registered engine is not reported as unreachable",
      hasLink: true,
      sync: async () => "no_engine",
      refusal: "other",
      failures: 0,
    },
  ];
  for (const { name, hasLink, sync, refusal, failures } of cases) {
    test(name, async () => {
      let failed = 0;
      const thrown = await retryEngineSyncWith(hasLink, sync, () => failed++).then(
        () => null,
        (err: unknown) => err
      );
      expect(failed).toBe(failures);
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
