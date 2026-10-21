import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { TwitchHelixResult } from "@woofx3/api";
import type { AuthorizedTwitchCall } from "./lib/twitchAuth";
import type { TwitchHelixRoute } from "./lib/twitchEngineHelix";
import {
  DIRECT_ROUTE,
  type EngineCall,
  type FetchCall,
  fakeEngineRoute,
  helixErrorBody,
  rejection,
  stubFetch,
} from "./lib/twitchEngineHelix.fakes";
import { logger } from "./logger";
import { fetchCurrentPin, repinOnTwitch, unpinOnTwitch } from "./pins";

const CALL: AuthorizedTwitchCall = { accessToken: "token", broadcasterUserId: "B1", clientId: "client" };
const PINS = `https://api.twitch.tv/helix/chat/pins?broadcaster_id=B1&moderator_id=B1`;
const MESSAGES = "https://api.twitch.tv/helix/chat/messages";
const PIN_BODY = {
  data: [
    {
      message_id: "m1",
      message: { text: "Rules: be nice" },
      sender_user_name: "Streamer",
      starts_at: "2026-10-18T20:00:00Z",
    },
  ],
};
const SENT = { data: [{ message_id: "m2", is_sent: true }] };
const REPIN = { kind: "repin", messageId: "m1" } as const;

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

function fetchAnswering(respond: (call: FetchCall) => Response) {
  fetchStub = stubFetch(respond);
  return fetchStub;
}

const noCheck = async () => {};

describe("without twitch.pins (or with its flag off)", () => {
  test("reads, pins, re-posts and unpins on Helix as before", async () => {
    const stub = fetchAnswering((call) =>
      call.url === MESSAGES
        ? Response.json(SENT)
        : call.init?.method === "PUT"
          ? new Response(null, { status: 400 })
          : Response.json(PIN_BODY)
    );
    expect((await fetchCurrentPin(CALL, DIRECT_ROUTE))?.messageId).toBe("m1");
    expect(await repinOnTwitch(CALL, DIRECT_ROUTE, REPIN, "Rules: be nice", noCheck)).toEqual({
      messageId: "m2",
      resent: true,
    });
    await unpinOnTwitch(CALL, DIRECT_ROUTE, "m2");
    expect(stub.calls.map((call) => [call.init?.method ?? "GET", call.url])).toEqual([
      ["GET", PINS],
      ["PUT", `${PINS}&message_id=m1`],
      ["POST", MESSAGES],
      ["DELETE", `${PINS}&message_id=m2`],
    ]);
  });
});

describe("through the engine", () => {
  test("reads, pins and unpins with the engine's twitch.pins methods", async () => {
    const stub = fetchAnswering(() => new Response(null, { status: 500 }));
    const engine = fakeEngineRoute((call: EngineCall) =>
      call.method === "twitchGetChatPins" ? { ok: true, body: PIN_BODY } : { ok: true, body: null }
    );
    expect((await fetchCurrentPin(CALL, engine.route))?.messageId).toBe("m1");
    expect(await repinOnTwitch(CALL, engine.route, REPIN, "Rules: be nice", noCheck)).toEqual({
      messageId: "m1",
      resent: false,
    });
    await unpinOnTwitch(CALL, engine.route, "m1");
    expect(engine.calls).toEqual([
      { method: "twitchGetChatPins", args: [] },
      { method: "twitchPinChatMessage", args: [{ message_id: "m1" }] },
      { method: "twitchUnpinChatMessage", args: [{ message_id: "m1" }] },
    ]);
    expect(stub.calls).toHaveLength(0);
  });

  test("a pin Twitch refuses is re-posted, pinned, through the engine", async () => {
    const engine = fakeEngineRoute((call: EngineCall) =>
      call.method === "twitchPinChatMessage"
        ? { ok: false, code: "helix", error: "", status: 400, body: helixErrorBody(400, "Message too old") }
        : { ok: true, body: SENT }
    );
    expect(await repinOnTwitch(CALL, engine.route, REPIN, "Rules: be nice", noCheck)).toEqual({
      messageId: "m2",
      resent: true,
    });
    expect(engine.calls[1]).toEqual({
      method: "twitchSendChatMessage",
      args: [{ message: "Rules: be nice", pin: true }],
    });
  });

  for (const [code, status] of [
    ["timeout", 504],
    ["failed", 502],
  ] as const) {
    test(`a pin that ends in ${code} is neither resent nor re-posted`, async () => {
      const stub = fetchAnswering(() => Response.json(SENT));
      const engine = fakeEngineRoute({ ok: false, code, error: "?" });
      expect(await rejection(() => repinOnTwitch(CALL, engine.route, REPIN, "Rules: be nice", noCheck))).toBe(
        `Twitch pin failed: ${status} `
      );
      expect(engine.calls.map((call) => call.method)).toEqual(["twitchPinChatMessage"]);
      expect(stub.calls).toHaveLength(0);
    });

    test(`an unpin that ends in ${code} is not resent`, async () => {
      const stub = fetchAnswering(() => new Response(null, { status: 204 }));
      expect(
        await rejection(() => unpinOnTwitch(CALL, fakeEngineRoute({ ok: false, code, error: "?" }).route, "m1"))
      ).toBe(`Twitch unpin failed: ${status} `);
      expect(stub.calls).toHaveLength(0);
    });
  }

  test("a pin read the engine could not answer goes to Helix", async () => {
    const stub = fetchAnswering(() => Response.json(PIN_BODY));
    expect(
      (await fetchCurrentPin(CALL, fakeEngineRoute({ ok: false, code: "failed", error: "?" }).route))?.messageId
    ).toBe("m1");
    expect(stub.calls).toHaveLength(1);
  });

  test("a pin the engine could not send goes to Helix", async () => {
    const stub = fetchAnswering(() => new Response(null, { status: 204 }));
    await repinOnTwitch(
      CALL,
      fakeEngineRoute({ ok: false, code: "not_linked", error: "?" }).route,
      REPIN,
      "x",
      noCheck
    );
    expect(stub.calls.map((call) => call.init?.method)).toEqual(["PUT"]);
  });
});

describe("Twitch's refusals read the same on either path", () => {
  const refusals: Array<[number, string]> = [
    [400, helixErrorBody(400, "Invalid message_id")],
    [401, helixErrorBody(401, "Invalid OAuth token")],
    [403, helixErrorBody(403, "Missing scope")],
    [429, helixErrorBody(429, "Too Many Requests")],
    [500, "upstream exploded"],
  ];
  const operations: Array<{ name: string; run: (route: TwitchHelixRoute) => Promise<unknown> }> = [
    { name: "pin lookup", run: (route) => fetchCurrentPin(CALL, route) },
    { name: "unpin", run: (route) => unpinOnTwitch(CALL, route, "m1") },
    { name: "re-post", run: (route) => repinOnTwitch(CALL, route, { kind: "resend", text: "x" }, "x", noCheck) },
  ];

  for (const operation of operations) {
    for (const [status, body] of refusals) {
      test(`${operation.name} on ${status}`, async () => {
        fetchAnswering(() => new Response(body, { status }));
        const direct = await rejection(() => operation.run(DIRECT_ROUTE));
        fetchStub?.restore();
        const result: TwitchHelixResult = { ok: false, code: "helix", error: "", status, body };
        expect(direct).not.toBeNull();
        expect(await rejection(() => operation.run(fakeEngineRoute(result).route))).toBe(direct);
      });
    }
  }
});
