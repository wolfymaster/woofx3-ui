import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { AuthorizedTwitchCall } from "./lib/twitchAuth";
import { DIRECT_ROUTE, fakeEngineRoute, helixErrorBody, rejection, stubFetch } from "./lib/twitchEngineHelixFakes";
import { logger } from "./logger";
import { helix, type ModerationRequest, moderationRequests, resolveTarget } from "./moderation";

const AUTH: AuthorizedTwitchCall = { accessToken: "token", broadcasterUserId: "B1", clientId: "client" };
const MOD = "broadcaster_id=B1&moderator_id=B1";
const HELIX = "https://api.twitch.tv/helix";

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

/**
 * Every moderation call with the Helix request Convex has always sent and
 * the engine call that replaces it.
 */
const CASES: Array<{
  name: string;
  request: ModerationRequest;
  kind: "read" | "write";
  helix: { method: string; url: string; body?: unknown };
  engine: { method: string; args: unknown[] };
}> = [
  {
    name: "first page of blocked terms",
    request: moderationRequests.listTerms(AUTH, undefined),
    kind: "read",
    helix: { method: "GET", url: `${HELIX}/moderation/blocked_terms?${MOD}&first=100` },
    engine: { method: "twitchGetBlockedTerms", args: [{ first: 100 }] },
  },
  {
    name: "next page of blocked terms",
    request: moderationRequests.listTerms(AUTH, "abc"),
    kind: "read",
    helix: { method: "GET", url: `${HELIX}/moderation/blocked_terms?${MOD}&first=100&after=abc` },
    engine: { method: "twitchGetBlockedTerms", args: [{ first: 100, after: "abc" }] },
  },
  {
    name: "add a blocked term",
    request: moderationRequests.addTerm(AUTH, "spoiler"),
    kind: "write",
    helix: { method: "POST", url: `${HELIX}/moderation/blocked_terms?${MOD}`, body: { text: "spoiler" } },
    engine: { method: "twitchAddBlockedTerm", args: [{ text: "spoiler" }] },
  },
  {
    name: "remove a blocked term",
    request: moderationRequests.removeTerm(AUTH, "t1"),
    kind: "write",
    helix: { method: "DELETE", url: `${HELIX}/moderation/blocked_terms?${MOD}&id=t1` },
    engine: { method: "twitchRemoveBlockedTerm", args: [{ id: "t1" }] },
  },
  {
    name: "timeout",
    request: moderationRequests.timeout(AUTH, "U2", 600),
    kind: "write",
    helix: {
      method: "POST",
      url: `${HELIX}/moderation/bans?${MOD}`,
      body: { data: { user_id: "U2", duration: 600 } },
    },
    engine: { method: "twitchBanUser", args: [{ user_id: "U2", duration: 600 }] },
  },
  {
    name: "ban",
    request: moderationRequests.ban(AUTH, "U2", "spam"),
    kind: "write",
    helix: {
      method: "POST",
      url: `${HELIX}/moderation/bans?${MOD}`,
      body: { data: { user_id: "U2", reason: "spam" } },
    },
    engine: { method: "twitchBanUser", args: [{ user_id: "U2", reason: "spam" }] },
  },
  {
    name: "unban",
    request: moderationRequests.unban(AUTH, "U2"),
    kind: "write",
    helix: { method: "DELETE", url: `${HELIX}/moderation/bans?${MOD}&user_id=U2` },
    engine: { method: "twitchUnbanUser", args: [{ user_id: "U2" }] },
  },
  {
    name: "read chat settings",
    request: moderationRequests.readSettings(AUTH),
    kind: "read",
    helix: { method: "GET", url: `${HELIX}/chat/settings?${MOD}` },
    engine: { method: "twitchGetChatSettings", args: [] },
  },
  {
    name: "update chat settings",
    request: moderationRequests.updateSettings(AUTH, { slow_mode: true, slow_mode_wait_time: 30 }),
    kind: "write",
    helix: {
      method: "PATCH",
      url: `${HELIX}/chat/settings?${MOD}`,
      body: { slow_mode: true, slow_mode_wait_time: 30 },
    },
    engine: { method: "twitchUpdateChatSettings", args: [{ slow_mode: true, slow_mode_wait_time: 30 }] },
  },
];

const OK_BODY = { data: [{ id: "x" }] };

describe("without twitch.moderation (or with its flag off)", () => {
  for (const c of CASES) {
    test(`${c.name} goes to Helix as before`, async () => {
      const stub = fetchAnswering(200, JSON.stringify(OK_BODY));
      expect(await helix(AUTH, DIRECT_ROUTE, c.request)).toEqual(OK_BODY);
      expect(stub.calls).toHaveLength(1);
      const [call] = stub.calls;
      expect(call.url).toBe(c.helix.url);
      expect(call.init?.method).toBe(c.helix.method);
      expect(call.init?.body).toBe(c.helix.body === undefined ? undefined : JSON.stringify(c.helix.body));
    });
  }

  test("looks the target up on Helix as before", async () => {
    const stub = fetchAnswering(200, JSON.stringify({ data: [{ id: "U2", login: "troll" }] }));
    expect((await resolveTarget(AUTH, DIRECT_ROUTE, "@Troll")).twitchUserId).toBe("U2");
    expect(stub.calls.map((call) => call.url)).toEqual([`${HELIX}/users?login=troll`]);
  });
});

describe("through the engine", () => {
  for (const c of CASES) {
    test(`${c.name} calls ${c.engine.method}`, async () => {
      const stub = fetchAnswering(500, null);
      const engine = fakeEngineRoute({ ok: true, body: OK_BODY });
      expect(await helix(AUTH, engine.route, c.request)).toEqual(OK_BODY);
      expect(engine.calls).toEqual([c.engine]);
      expect(stub.calls).toHaveLength(0);
    });
  }

  test("a 204 reads as no body", async () => {
    const engine = fakeEngineRoute({ ok: true, body: null });
    expect(await helix(AUTH, engine.route, moderationRequests.unban(AUTH, "U2"))).toBeNull();
  });

  test("looks the target up with twitchGetUsers", async () => {
    const engine = fakeEngineRoute({ ok: true, body: { data: [{ id: "U2", login: "troll" }] } });
    expect((await resolveTarget(AUTH, engine.route, "@Troll")).twitchUserId).toBe("U2");
    expect(engine.calls).toEqual([{ method: "twitchGetUsers", args: [{ login: "troll" }] }]);
  });

  for (const c of CASES) {
    for (const code of ["timeout", "failed"] as const) {
      if (c.kind === "read") {
        test(`${c.name} after ${code} goes to Helix`, async () => {
          const stub = fetchAnswering(200, JSON.stringify(OK_BODY));
          expect(await helix(AUTH, fakeEngineRoute({ ok: false, code, error: "?" }).route, c.request)).toEqual(OK_BODY);
          expect(stub.calls).toHaveLength(1);
        });
      } else {
        test(`${c.name} after ${code} is not resent`, async () => {
          const stub = fetchAnswering(200, JSON.stringify(OK_BODY));
          const message = await rejection(() =>
            helix(AUTH, fakeEngineRoute({ ok: false, code, error: "?" }).route, c.request)
          );
          expect(message).not.toBeNull();
          expect(stub.calls).toHaveLength(0);
        });
      }
    }

    test(`${c.name} the engine could not send goes to Helix`, async () => {
      const stub = fetchAnswering(200, JSON.stringify(OK_BODY));
      await helix(AUTH, fakeEngineRoute({ ok: false, code: "not_linked", error: "?" }).route, c.request);
      expect(stub.calls).toHaveLength(1);
    });
  }
});

describe("Twitch's refusals read the same on either path", () => {
  const refusals: Array<[number, string]> = [
    [400, helixErrorBody(400, "The user specified in the user_id field is already banned.")],
    [400, helixErrorBody(400, "The text field is too long")],
    [401, helixErrorBody(401, "Invalid OAuth token")],
    [403, helixErrorBody(403, "Forbidden")],
    [409, helixErrorBody(409, "Conflict")],
    [429, helixErrorBody(429, "Too Many Requests")],
    [500, "upstream exploded"],
    [502, ""],
  ];

  for (const c of CASES) {
    for (const [status, body] of refusals) {
      test(`${c.name} on ${status} ${body}`, async () => {
        fetchAnswering(status, body || null);
        const direct = await rejection(() => helix(AUTH, DIRECT_ROUTE, c.request));
        fetchStub?.restore();
        const engine = fakeEngineRoute({ ok: false, code: "helix", error: "", status, body });
        expect(direct).not.toBeNull();
        expect(await rejection(() => helix(AUTH, engine.route, c.request))).toBe(direct);
      });
    }
  }

  test("a failed user lookup reads the same", async () => {
    const body = helixErrorBody(400, "Invalid login names");
    fetchAnswering(400, body);
    const direct = await rejection(() => resolveTarget(AUTH, DIRECT_ROUTE, "troll"));
    fetchStub?.restore();
    const engine = fakeEngineRoute({ ok: false, code: "helix", error: "", status: 400, body });
    expect(direct).toBe(`Twitch user lookup failed: 400 ${body}`);
    expect(await rejection(() => resolveTarget(AUTH, engine.route, "troll"))).toBe(direct);
  });
});
