import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { TwitchHelixResult } from "@woofx3/api";
import type { AuthorizedTwitchCall } from "./lib/twitchAuth";
import type { TwitchHelixRoute } from "./lib/twitchEngineHelix";
import { DIRECT_ROUTE, fakeEngineRoute, helixErrorBody, rejection, stubFetch } from "./lib/twitchEngineHelix.fakes";
import { logger } from "./logger";
import {
  createMarkerOnTwitch,
  fetchCategory,
  fetchChannelInfo,
  modifyChannelInformation,
  searchCategoriesOnTwitch,
} from "./streamInfo";

const CALL: AuthorizedTwitchCall = { accessToken: "token", broadcasterUserId: "B1", clientId: "client" };

const CHANNEL_BODY = {
  data: [{ broadcaster_id: "B1", title: "Speedruns", game_id: "33", game_name: "Doom", tags: ["en"] }],
};
const GAMES_BODY = {
  data: [{ id: "33", name: "Doom", box_art_url: "https://static-cdn.jtvnw.net/x-{width}x{height}.jpg" }],
};
const MARKER_BODY = { data: [{ id: "m1", position_seconds: 120, created_at: "2026-10-18T20:00:00Z" }] };

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

function json(body: unknown): string {
  return JSON.stringify(body);
}

/** Each Helix call this module makes, run on a route. */
const OPERATIONS: Array<{ name: string; run: (route: TwitchHelixRoute) => Promise<unknown>; kind: "read" | "write" }> =
  [
    { name: "fetchChannelInfo", run: (route) => fetchChannelInfo(CALL, route), kind: "read" },
    { name: "searchCategoriesOnTwitch", run: (route) => searchCategoriesOnTwitch(CALL, route, "doom"), kind: "read" },
    {
      name: "modifyChannelInformation",
      run: (route) => modifyChannelInformation(CALL, route, { title: "New" }),
      kind: "write",
    },
    { name: "createMarkerOnTwitch", run: (route) => createMarkerOnTwitch(CALL, route, "clip this"), kind: "write" },
  ];

describe("without twitch.streamInfo", () => {
  test("reads the channel from Helix as before", async () => {
    const stub = fetchAnswering(200, json(CHANNEL_BODY));
    const info = await fetchChannelInfo(CALL, DIRECT_ROUTE);
    expect(info).toEqual({ title: "Speedruns", category: { id: "33", name: "Doom" }, tags: ["en"] });
    expect(stub.calls.map((call) => call.url)).toEqual(["https://api.twitch.tv/helix/channels?broadcaster_id=B1"]);
  });

  test("writes the channel to Helix as before", async () => {
    const stub = fetchAnswering(204, null);
    await modifyChannelInformation(CALL, DIRECT_ROUTE, { title: "New", category: null, tags: ["en"] });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].init?.method).toBe("PATCH");
    expect(stub.calls[0].init?.body).toBe(json({ title: "New", game_id: "", tags: ["en"] }));
  });

  test("adds a marker on Helix as before", async () => {
    const stub = fetchAnswering(200, json(MARKER_BODY));
    expect(await createMarkerOnTwitch(CALL, DIRECT_ROUTE, "")).toEqual({
      positionSeconds: 120,
      createdAt: "2026-10-18T20:00:00Z",
    });
    expect(stub.calls[0].url).toBe("https://api.twitch.tv/helix/streams/markers");
    expect(stub.calls[0].init?.body).toBe(json({ user_id: "B1" }));
  });
});

describe("with twitch.streamInfo", () => {
  test("reads the channel and its box art from the engine", async () => {
    const stub = fetchAnswering(500, null);
    const channel = fakeEngineRoute({ ok: true, body: CHANNEL_BODY });
    expect(await fetchChannelInfo(CALL, channel.route)).toEqual({
      title: "Speedruns",
      category: { id: "33", name: "Doom" },
      tags: ["en"],
    });
    const games = fakeEngineRoute({ ok: true, body: GAMES_BODY });
    expect((await fetchCategory(CALL, games.route, "33"))?.name).toBe("Doom");
    expect([...channel.calls, ...games.calls]).toEqual([
      { method: "twitchGetChannelInformation", args: [] },
      { method: "twitchGetGames", args: [{ id: "33" }] },
    ]);
    expect(stub.calls).toHaveLength(0);
  });

  test("searches categories on the engine with Helix's parameters", async () => {
    const engine = fakeEngineRoute({ ok: true, body: GAMES_BODY });
    const categories = await searchCategoriesOnTwitch(CALL, engine.route, "doom");
    expect(categories.map((category) => category.id)).toEqual(["33"]);
    expect(engine.calls).toEqual([{ method: "twitchSearchCategories", args: [{ query: "doom", first: 10 }] }]);
  });

  test("writes only the changed fields, by Helix's names", async () => {
    const engine = fakeEngineRoute({ ok: true, body: null });
    await modifyChannelInformation(CALL, engine.route, { category: { id: "33", name: "Doom" } });
    await modifyChannelInformation(CALL, engine.route, { title: "New", category: null, tags: [] });
    expect(engine.calls).toEqual([
      { method: "twitchModifyChannelInformation", args: [{ game_id: "33" }] },
      { method: "twitchModifyChannelInformation", args: [{ title: "New", game_id: "", tags: [] }] },
    ]);
  });

  test("adds a marker, with a description only when there is one", async () => {
    const engine = fakeEngineRoute({ ok: true, body: MARKER_BODY });
    expect(await createMarkerOnTwitch(CALL, engine.route, "clip this")).toEqual({
      positionSeconds: 120,
      createdAt: "2026-10-18T20:00:00Z",
    });
    await createMarkerOnTwitch(CALL, engine.route, "");
    expect(engine.calls).toEqual([
      { method: "twitchCreateStreamMarker", args: [{ description: "clip this" }] },
      { method: "twitchCreateStreamMarker", args: [{}] },
    ]);
  });

  test("a read the engine could not answer goes to Helix", async () => {
    const stub = fetchAnswering(200, json(CHANNEL_BODY));
    const engine = fakeEngineRoute({ ok: false, code: "failed", error: "Twitch unreachable" });
    expect((await fetchChannelInfo(CALL, engine.route)).title).toBe("Speedruns");
    expect(stub.calls).toHaveLength(1);
  });

  for (const code of ["timeout", "failed"] as const) {
    test(`a write that ends in ${code} is not resent to Helix`, async () => {
      const stub = fetchAnswering(204, null);
      const engine = fakeEngineRoute({ ok: false, code, error: "?" });
      const status = code === "timeout" ? 504 : 502;
      expect(await rejection(() => modifyChannelInformation(CALL, engine.route, { title: "New" }))).toBe(
        `Couldn't update your stream info: Twitch answered ${status}`
      );
      expect(await rejection(() => createMarkerOnTwitch(CALL, engine.route, ""))).toBe(
        `Couldn't add a marker: Twitch answered ${status}`
      );
      expect(stub.calls).toHaveLength(0);
    });
  }

  test("a write the engine could not send goes to Helix", async () => {
    const stub = fetchAnswering(204, null);
    const engine = fakeEngineRoute({ ok: false, code: "not_linked", error: "no link" });
    await modifyChannelInformation(CALL, engine.route, { title: "New" });
    expect(stub.calls).toHaveLength(1);
  });
});

describe("Twitch's refusals read the same on either path", () => {
  const refusals: Array<[number, string]> = [
    [400, helixErrorBody(400, "The tag contains an invalid character")],
    [401, helixErrorBody(401, "Invalid OAuth token")],
    [403, helixErrorBody(403, "The user is not the broadcaster or an editor")],
    [404, helixErrorBody(404, "Not live")],
    [429, helixErrorBody(429, "Too Many Requests")],
    [500, "upstream exploded"],
    [503, ""],
  ];

  for (const operation of OPERATIONS) {
    for (const [status, body] of refusals) {
      test(`${operation.name} on ${status}`, async () => {
        fetchAnswering(status, body || null);
        const direct = await rejection(() => operation.run(DIRECT_ROUTE));
        fetchStub?.restore();
        const helixResult: TwitchHelixResult = {
          ok: false,
          code: "helix",
          error: `Twitch answered ${status}`,
          status,
          body,
        };
        const viaEngine = await rejection(() => operation.run(fakeEngineRoute(helixResult).route));
        expect(direct).not.toBeNull();
        expect(viaEngine).toBe(direct);
      });
    }
  }

  test("a missing category's box art is still just missing", async () => {
    fetchAnswering(404, helixErrorBody(404, "Not Found"));
    const direct = await fetchCategory(CALL, DIRECT_ROUTE, "33");
    const engine = fakeEngineRoute({ ok: false, code: "helix", error: "", status: 404, body: "" });
    expect(await fetchCategory(CALL, engine.route, "33")).toBe(direct);
    expect(direct).toBeNull();
  });
});
