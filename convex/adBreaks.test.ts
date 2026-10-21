import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { callHelix } from "./adBreaks";
import type { AdHelixOperation } from "./lib/adBreaks";
import type { AuthorizedTwitchCall } from "./lib/twitchAuth";
import { DIRECT_ROUTE, fakeEngineRoute, helixErrorBody, rejection, stubFetch } from "./lib/twitchEngineHelix.fakes";
import { logger } from "./logger";

const CALL: AuthorizedTwitchCall = { accessToken: "token", broadcasterUserId: "B1", clientId: "client" };
const SCHEDULE_BODY = { data: [{ next_ad_at: "1760817600", duration: 90, snooze_count: 2 }] };
const SNOOZE_BODY = { data: [{ snooze_count: 1, snooze_refresh_at: "1760821200", next_ad_at: "1760818200" }] };

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

describe("without twitch.ads", () => {
  test("reads the schedule and snoozes on Helix as before", async () => {
    const stub = fetchAnswering(200, JSON.stringify(SCHEDULE_BODY));
    expect(await callHelix(CALL, DIRECT_ROUTE, "read")).toEqual(SCHEDULE_BODY);
    await callHelix(CALL, DIRECT_ROUTE, "snooze");
    expect(stub.calls.map((call) => [call.init?.method, call.url])).toEqual([
      ["GET", "https://api.twitch.tv/helix/channels/ads?broadcaster_id=B1"],
      ["POST", "https://api.twitch.tv/helix/channels/ads/schedule/snooze?broadcaster_id=B1"],
    ]);
  });
});

describe("with twitch.ads", () => {
  test("reads the schedule and snoozes through the engine", async () => {
    const stub = fetchAnswering(500, null);
    const schedule = fakeEngineRoute({ ok: true, body: SCHEDULE_BODY });
    expect(await callHelix(CALL, schedule.route, "read")).toEqual(SCHEDULE_BODY);
    const snooze = fakeEngineRoute({ ok: true, body: SNOOZE_BODY });
    expect(await callHelix(CALL, snooze.route, "snooze")).toEqual(SNOOZE_BODY);
    expect([...schedule.calls, ...snooze.calls]).toEqual([
      { method: "twitchGetAdSchedule", args: [] },
      { method: "twitchSnoozeNextAd", args: [] },
    ]);
    expect(stub.calls).toHaveLength(0);
  });

  for (const code of ["failed", "timeout", "not_linked", "unavailable"] as const) {
    test(`a schedule read the engine ends with ${code} goes to Helix`, async () => {
      const stub = fetchAnswering(200, JSON.stringify(SCHEDULE_BODY));
      expect(await callHelix(CALL, fakeEngineRoute({ ok: false, code, error: "?" }).route, "read")).toEqual(
        SCHEDULE_BODY
      );
      expect(stub.calls).toHaveLength(1);
    });
  }

  for (const [code, status] of [
    ["timeout", 504],
    ["failed", 502],
  ] as const) {
    test(`a snooze that ends in ${code} is not resent, since Twitch may have spent it`, async () => {
      const stub = fetchAnswering(200, JSON.stringify(SNOOZE_BODY));
      const engine = fakeEngineRoute({ ok: false, code, error: "?" });
      expect(await rejection(() => callHelix(CALL, engine.route, "snooze"))).toBe(
        `Could not snooze the next ad: Twitch answered ${status}`
      );
      expect(stub.calls).toHaveLength(0);
    });
  }

  test("a snooze the engine could not send goes to Helix", async () => {
    const stub = fetchAnswering(200, JSON.stringify(SNOOZE_BODY));
    await callHelix(CALL, fakeEngineRoute({ ok: false, code: "unavailable", error: "?" }).route, "snooze");
    expect(stub.calls).toHaveLength(1);
  });
});

describe("Twitch's refusals read the same on either path", () => {
  const refusals: Array<[number, string]> = [
    [400, helixErrorBody(400, "The channel is not live")],
    [401, helixErrorBody(401, "Missing scope: channel:read:ads")],
    [401, helixErrorBody(401, "Invalid OAuth token")],
    [403, helixErrorBody(403, "Forbidden")],
    [429, helixErrorBody(429, "No snoozes left")],
    [429, ""],
    [500, "upstream exploded"],
    [503, ""],
  ];

  for (const operation of ["read", "snooze"] satisfies AdHelixOperation[]) {
    for (const [status, body] of refusals) {
      test(`${operation} on ${status} ${body}`, async () => {
        fetchAnswering(status, body || null);
        const direct = await rejection(() => callHelix(CALL, DIRECT_ROUTE, operation));
        fetchStub?.restore();
        const engine = fakeEngineRoute({ ok: false, code: "helix", error: "", status, body });
        expect(direct).not.toBeNull();
        expect(await rejection(() => callHelix(CALL, engine.route, operation))).toBe(direct);
      });
    }
  }
});
