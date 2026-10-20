import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { AuthorizedTwitchCall } from "./lib/twitchAuth";
import { DIRECT_ROUTE, fakeEngineRoute, helixErrorBody, rejection, stubFetch } from "./lib/twitchEngineHelixFakes";
import { logger } from "./logger";
import { fetchChatters, sendQueuedShoutout } from "./shoutouts";

const CALL: AuthorizedTwitchCall = { accessToken: "token", broadcasterUserId: "B1", clientId: "client" };
const HELIX = "https://api.twitch.tv/helix";
const CHATTERS = { data: [{ user_id: "U2", user_login: "friend", user_name: "Friend" }], total: 1 };
const ROSTER = [{ userId: "U2", login: "friend", displayName: "Friend" }];

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

describe("without twitch.chat (or with the shoutout flag off)", () => {
  test("reads chatters and sends a queued shoutout on Helix as before", async () => {
    const stub = fetchAnswering(200, JSON.stringify(CHATTERS));
    expect(await fetchChatters(CALL, DIRECT_ROUTE)).toEqual(ROSTER);
    await sendQueuedShoutout(CALL, DIRECT_ROUTE, "U2");
    expect(stub.calls.map((call) => [call.init?.method ?? "GET", call.url])).toEqual([
      ["GET", `${HELIX}/chat/chatters?broadcaster_id=B1&moderator_id=B1&first=1000`],
      ["POST", `${HELIX}/chat/shoutouts?from_broadcaster_id=B1&to_broadcaster_id=U2&moderator_id=B1`],
    ]);
  });
});

describe("through the engine", () => {
  test("reads chatters and sends a queued shoutout on the engine", async () => {
    const stub = fetchAnswering(500, null);
    const chatters = fakeEngineRoute({ ok: true, body: CHATTERS });
    expect(await fetchChatters(CALL, chatters.route)).toEqual(ROSTER);
    const shoutout = fakeEngineRoute({ ok: true, body: null });
    await sendQueuedShoutout(CALL, shoutout.route, "U2");
    expect([...chatters.calls, ...shoutout.calls]).toEqual([
      { method: "twitchGetChatters", args: [{ first: 1000 }] },
      { method: "twitchSendShoutout", args: [{ to_broadcaster_id: "U2" }] },
    ]);
    expect(stub.calls).toHaveLength(0);
  });

  test("a chatters read the engine could not answer goes to Helix", async () => {
    const stub = fetchAnswering(200, JSON.stringify(CHATTERS));
    expect(await fetchChatters(CALL, fakeEngineRoute({ ok: false, code: "timeout", error: "?" }).route)).toEqual(
      ROSTER
    );
    expect(stub.calls).toHaveLength(1);
  });

  for (const [code, status] of [
    ["timeout", 504],
    ["failed", 502],
  ] as const) {
    test(`a queued shoutout that ends in ${code} is not resent and lands as the entry's error`, async () => {
      const stub = fetchAnswering(204, null);
      expect(
        await rejection(() => sendQueuedShoutout(CALL, fakeEngineRoute({ ok: false, code, error: "?" }).route, "U2"))
      ).toBe(`Twitch shoutout failed: ${status} `);
      expect(stub.calls).toHaveLength(0);
    });
  }

  test("a queued shoutout the engine could not send goes to Helix", async () => {
    const stub = fetchAnswering(204, null);
    await sendQueuedShoutout(CALL, fakeEngineRoute({ ok: false, code: "unavailable", error: "?" }).route, "U2");
    expect(stub.calls).toHaveLength(1);
  });
});

describe("Twitch's refusals read the same on either path", () => {
  const refusals: Array<[number, string]> = [
    [400, helixErrorBody(400, "The broadcaster is not streaming live")],
    [401, helixErrorBody(401, "Invalid OAuth token")],
    [403, helixErrorBody(403, "Missing scope")],
    [429, helixErrorBody(429, "Too Many Requests")],
    [500, "upstream exploded"],
  ];
  const operations = [
    { name: "chatters", run: (route: typeof DIRECT_ROUTE) => fetchChatters(CALL, route) },
    { name: "queued shoutout", run: (route: typeof DIRECT_ROUTE) => sendQueuedShoutout(CALL, route, "U2") },
  ];

  for (const operation of operations) {
    for (const [status, body] of refusals) {
      test(`${operation.name} on ${status}`, async () => {
        fetchAnswering(status, body);
        const direct = await rejection(() => operation.run(DIRECT_ROUTE));
        fetchStub?.restore();
        const engine = fakeEngineRoute({ ok: false, code: "helix", error: "", status, body });
        expect(direct).not.toBeNull();
        expect(await rejection(() => operation.run(engine.route))).toBe(direct);
      });
    }
  }
});
