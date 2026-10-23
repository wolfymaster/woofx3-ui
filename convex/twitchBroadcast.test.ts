import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { TwitchHelixResult } from "@woofx3/api";
import { fakeGatewayRoute, twitchAnswer } from "./lib/platformGateway.fakes";
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
import { postAnnouncement, postChatMessage, postShoutout, sendAnnouncementLine, sendChatLine } from "./twitchBroadcast";

const CALL: AuthorizedTwitchCall = { accessToken: "token", broadcasterUserId: "B1", clientId: "client" };
const HELIX = "https://api.twitch.tv/helix";
const SENT = { data: [{ message_id: "m1", is_sent: true }] };
const DROPPED = {
  data: [{ message_id: "", is_sent: false, drop_reason: { code: "automod", message: "Held by AutoMod" } }],
};
const USER = { data: [{ id: "U2", login: "friend", display_name: "Friend" }] };

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

/** Helix as Convex reaches it: the user lookup answers with USER, the call itself with `status` and `body`. */
function helixAnswering(status: number, body: string | null) {
  return fetchAnswering((call) =>
    call.url.startsWith(`${HELIX}/users`) ? Response.json(USER) : new Response(body, { status })
  );
}

/** The engine, likewise. */
function engineAnswering(answer: TwitchHelixResult) {
  return fakeEngineRoute((call: EngineCall) => (call.method === "twitchGetUsers" ? { ok: true, body: USER } : answer));
}

const OPERATIONS: Array<{ name: string; run: (route: TwitchHelixRoute) => Promise<void> }> = [
  { name: "chat message", run: (route) => postChatMessage(CALL, route, "hello chat") },
  { name: "announcement", run: (route) => postAnnouncement(CALL, route, "we're live", "purple") },
  { name: "shoutout", run: (route) => postShoutout(CALL, route, "friend") },
];

describe("without twitch.chat (or with its flag off)", () => {
  test("each send goes to Helix as before", async () => {
    const stub = helixAnswering(200, JSON.stringify(SENT));
    for (const operation of OPERATIONS) {
      await operation.run(DIRECT_ROUTE);
    }
    expect(stub.calls.map((call) => [call.init?.method ?? "GET", call.url, call.init?.body])).toEqual([
      [
        "POST",
        `${HELIX}/chat/messages`,
        JSON.stringify({ broadcaster_id: "B1", sender_id: "B1", message: "hello chat" }),
      ],
      [
        "POST",
        `${HELIX}/chat/announcements?broadcaster_id=B1&moderator_id=B1`,
        JSON.stringify({ message: "we're live", color: "purple" }),
      ],
      ["GET", `${HELIX}/users?login=friend`, undefined],
      ["POST", `${HELIX}/chat/shoutouts?from_broadcaster_id=B1&to_broadcaster_id=U2&moderator_id=B1`, undefined],
    ]);
  });
});

describe("through the engine", () => {
  test("each send calls the engine with Helix's parameters", async () => {
    const stub = helixAnswering(500, null);
    const engine = engineAnswering({ ok: true, body: SENT });
    for (const operation of OPERATIONS) {
      await operation.run(engine.route);
    }
    expect(engine.calls).toEqual([
      { method: "twitchSendChatMessage", args: [{ message: "hello chat" }] },
      { method: "twitchSendChatAnnouncement", args: [{ message: "we're live", color: "purple" }] },
      { method: "twitchGetUsers", args: [{ login: "friend" }] },
      { method: "twitchSendShoutout", args: [{ to_broadcaster_id: "U2" }] },
    ]);
    expect(stub.calls).toHaveLength(0);
  });

  test("a message Twitch dropped reads the same as on Helix", async () => {
    helixAnswering(200, JSON.stringify(DROPPED));
    const direct = await rejection(() => postChatMessage(CALL, DIRECT_ROUTE, "hello"));
    expect(direct).toBe("Held by AutoMod");
    expect(
      await rejection(() => postChatMessage(CALL, engineAnswering({ ok: true, body: DROPPED }).route, "hello"))
    ).toBe(direct);
  });

  test("a shoutout to nobody reads the same as on Helix", async () => {
    fetchAnswering(() => Response.json({ data: [] }));
    const direct = await rejection(() => postShoutout(CALL, DIRECT_ROUTE, "ghost"));
    const engine = fakeEngineRoute({ ok: true, body: { data: [] } });
    expect(await rejection(() => postShoutout(CALL, engine.route, "ghost"))).toBe(direct);
    expect(direct).toBe('No Twitch channel called "ghost"');
  });

  for (const operation of OPERATIONS) {
    for (const [code, status] of [
      ["timeout", 504],
      ["failed", 502],
    ] as const) {
      test(`a ${operation.name} that ends in ${code} is not resent`, async () => {
        const stub = helixAnswering(200, JSON.stringify(SENT));
        const message = await rejection(() => operation.run(engineAnswering({ ok: false, code, error: "?" }).route));
        expect(message).toContain(String(status));
        expect(stub.calls).toHaveLength(0);
      });
    }

    for (const code of ["not_linked", "unavailable", "invalid_arguments"] as const) {
      test(`a ${operation.name} the engine could not send (${code}) goes to Helix`, async () => {
        const stub = helixAnswering(200, JSON.stringify(SENT));
        const error = spyOn(logger, "error").mockImplementation(() => {});
        await operation.run(engineAnswering({ ok: false, code, error: "?" }).route);
        error.mockRestore();
        expect(stub.calls.filter((call) => !call.url.startsWith(`${HELIX}/users`))).toHaveLength(1);
      });
    }
  }
});

describe("Twitch's refusals read the same on either path", () => {
  const refusals: Array<[number, string]> = [
    [400, helixErrorBody(400, "The broadcaster is not streaming live")],
    [401, helixErrorBody(401, "Invalid OAuth token")],
    [403, helixErrorBody(403, "The sender is banned")],
    [422, helixErrorBody(422, "The message is too long")],
    [429, helixErrorBody(429, "Too Many Requests")],
    [500, "upstream exploded"],
  ];

  for (const operation of OPERATIONS) {
    for (const [status, body] of refusals) {
      test(`${operation.name} on ${status}`, async () => {
        helixAnswering(status, body);
        const direct = await rejection(() => operation.run(DIRECT_ROUTE));
        fetchStub?.restore();
        const viaEngine = await rejection(() =>
          operation.run(engineAnswering({ ok: false, code: "helix", error: "", status, body }).route)
        );
        expect(direct).not.toBeNull();
        expect(viaEngine).toBe(direct);
      });
    }
  }
});

describe("through the platform gateway", () => {
  test("a chat message and an announcement go to Twitch with their keys, and never to Helix", async () => {
    const stub = helixAnswering(200, JSON.stringify(SENT));
    const gateway = fakeGatewayRoute(twitchAnswer({ status: "delivered", messageId: "m1" }));
    await sendChatLine(CALL, gateway.route, "hello chat", "dashboard:op_12345678:chat.send");
    await sendAnnouncementLine(CALL, gateway.route, "we're live", "purple", "dashboard:op_12345678:chat.announce");
    expect(gateway.calls).toEqual([
      {
        action: "chat.send",
        platforms: ["twitch"],
        payload: { message: "hello chat" },
        idempotencyKey: "dashboard:op_12345678:chat.send",
      },
      {
        action: "chat.announce",
        platforms: ["twitch"],
        payload: { message: "we're live" },
        options: { twitch: { color: "purple" } },
        idempotencyKey: "dashboard:op_12345678:chat.announce",
      },
    ]);
    expect(stub.calls).toHaveLength(0);
  });

  test("a line the gateway could not confirm fails once, with no second send anywhere", async () => {
    const stub = helixAnswering(200, JSON.stringify(SENT));
    const gateway = fakeGatewayRoute({ ok: false, code: "timeout", error: "may have been sent" });
    expect(await rejection(() => sendChatLine(CALL, gateway.route, "hello", "k"))).toContain("may already be in chat");
    expect(gateway.calls).toHaveLength(1);
    expect(stub.calls).toHaveLength(0);
  });

  test("a line Twitch dropped says why", async () => {
    const gateway = fakeGatewayRoute(twitchAnswer({ status: "dropped", reason: "Held by AutoMod" }));
    expect(await rejection(() => sendChatLine(CALL, gateway.route, "hello", "k"))).toBe(
      "Twitch didn't post the chat message: Held by AutoMod"
    );
  });

  test("Twitch turned off in the engine is not worked around through Helix", async () => {
    const stub = helixAnswering(200, JSON.stringify(SENT));
    const gateway = fakeGatewayRoute(twitchAnswer({ status: "unavailable", reason: "disabled" }));
    expect(await rejection(() => sendAnnouncementLine(CALL, gateway.route, "hi", "primary", "k"))).toBe(
      "The announcement wasn't sent: Twitch is turned off in the engine"
    );
    expect(stub.calls).toHaveLength(0);
  });

  test("without the gateway the Helix route is used", async () => {
    const stub = helixAnswering(200, JSON.stringify(SENT));
    await sendChatLine(CALL, { kind: "helix", helix: DIRECT_ROUTE }, "hello chat", "k");
    expect(stub.calls.map((call) => call.url)).toEqual([`${HELIX}/chat/messages`]);
  });
});
