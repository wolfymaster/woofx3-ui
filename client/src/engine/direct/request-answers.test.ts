import { describe, expect, test } from "bun:test";
import { EngineRequestType, makeRequestEnvelope } from "@woofx3/api";
import { RecordingLogger } from "@/lib/engine-session/testing/RecordingLogger";
import { answerFor, REQUEST_ANSWERS } from "./request-answers";

describe("answerFor", () => {
  const expected: Record<EngineRequestType, unknown> = {
    [EngineRequestType.TWITCH_TOKEN_REQUESTED]: { ok: false, error: "this client holds no Twitch tokens" },
    [EngineRequestType.RELAY_CREDENTIAL_REQUESTED]: { ok: true, body: { relay: null } },
    [EngineRequestType.SHOUTOUT_ENQUEUE_REQUESTED]: { ok: false, error: "this client keeps no shoutout queue" },
  };

  test("every request type the engine sends has an answer", () => {
    expect(Object.keys(REQUEST_ANSWERS).sort()).toEqual(Object.values(EngineRequestType).sort());
  });

  for (const type of Object.values(EngineRequestType)) {
    test(`answers ${type}`, () => {
      const envelope = makeRequestEnvelope({ type } as Parameters<typeof makeRequestEnvelope>[0], "engine", "r-1");
      expect(answerFor(envelope, new RecordingLogger())).toEqual(expected[type] as never);
    });
  }

  test("refuses and logs a request type this build does not know", () => {
    const logger = new RecordingLogger();
    const envelope = makeRequestEnvelope({ type: EngineRequestType.TWITCH_TOKEN_REQUESTED }, "engine", "r-2");
    const unknown = { ...envelope, type: "future.thing.requested" as EngineRequestType };
    expect(answerFor(unknown, logger)).toEqual({ ok: false, error: "unknown request future.thing.requested" });
    expect(logger.entries.map((entry) => entry.level)).toEqual(["warn"]);
  });
});
