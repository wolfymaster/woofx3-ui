import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { logger } from "../logger";
import type { AuthorizedTwitchCall } from "./twitchAuth";
import { sendChatMessage } from "./twitchChat";
import { DIRECT_ROUTE, fakeEngineRoute, helixErrorBody, rejection, stubFetch } from "./twitchEngineHelixFakes";

const CALL: AuthorizedTwitchCall = { accessToken: "token", broadcasterUserId: "B1", clientId: "client" };
const SENT = { data: [{ message_id: "m1", is_sent: true }] };

let fetchStub: ReturnType<typeof stubFetch> | null = null;
let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  warn = spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
  warn.mockRestore();
});

function fetchAnswering(status: number, body: string | null) {
  fetchStub = stubFetch(() => new Response(body, { status }));
  return fetchStub;
}

describe("sendChatMessage", () => {
  test("posts to Helix as before without an engine route", async () => {
    const stub = fetchAnswering(200, JSON.stringify(SENT));
    expect(await sendChatMessage(CALL, "hi", { pin: false }, DIRECT_ROUTE)).toBe("m1");
    expect(await sendChatMessage(CALL, "hi", { pin: true }, DIRECT_ROUTE)).toBe("m1");
    expect(stub.calls.map((call) => call.init?.body)).toEqual([
      JSON.stringify({ broadcaster_id: "B1", sender_id: "B1", message: "hi" }),
      JSON.stringify({ broadcaster_id: "B1", sender_id: "B1", message: "hi", pin: true }),
    ]);
  });

  test("sends through the engine, with pin only when pinning", async () => {
    const stub = fetchAnswering(500, null);
    const engine = fakeEngineRoute({ ok: true, body: SENT });
    expect(await sendChatMessage(CALL, "hi", { pin: false }, engine.route)).toBe("m1");
    expect(await sendChatMessage(CALL, "hi", { pin: true }, engine.route)).toBe("m1");
    expect(engine.calls).toEqual([
      { method: "twitchSendChatMessage", args: [{ message: "hi" }] },
      { method: "twitchSendChatMessage", args: [{ message: "hi", pin: true }] },
    ]);
    expect(stub.calls).toHaveLength(0);
  });

  test("a send that ends in timeout is not resent", async () => {
    const stub = fetchAnswering(200, JSON.stringify(SENT));
    const engine = fakeEngineRoute({ ok: false, code: "timeout", error: "?" });
    expect(await rejection(() => sendChatMessage(CALL, "hi", { pin: false }, engine.route))).toBe(
      "Twitch chat send failed: 504 "
    );
    expect(stub.calls).toHaveLength(0);
  });

  for (const [status, body] of [
    [400, helixErrorBody(400, "Pinning is not available")],
    [401, helixErrorBody(401, "Invalid OAuth token")],
    [500, "upstream exploded"],
  ] as const) {
    test(`Twitch's ${status} reads the same on either path`, async () => {
      fetchAnswering(status, body);
      const direct = await rejection(() => sendChatMessage(CALL, "hi", { pin: true }, DIRECT_ROUTE));
      fetchStub?.restore();
      const engine = fakeEngineRoute({ ok: false, code: "helix", error: "", status, body });
      expect(direct).not.toBeNull();
      expect(await rejection(() => sendChatMessage(CALL, "hi", { pin: true }, engine.route))).toBe(direct);
    });
  }
});
