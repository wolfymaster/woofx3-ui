import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { AuthorizedTwitchCall } from "./lib/twitchAuth";
import { DIRECT_ROUTE, fakeEngineRoute, helixErrorBody, rejection, stubFetch } from "./lib/twitchEngineHelixFakes";
import { logger } from "./logger";
import { createClipOnTwitch } from "./twitchClips";

const CALL: AuthorizedTwitchCall = { accessToken: "token", broadcasterUserId: "B1", clientId: "client" };
const CLIP = { data: [{ id: "c1", edit_url: "https://clips.twitch.tv/c1/edit" }] };

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

describe("createClipOnTwitch", () => {
  test("creates the clip on Helix as before without an engine route", async () => {
    const stub = fetchAnswering(202, JSON.stringify(CLIP));
    expect(await createClipOnTwitch(CALL, DIRECT_ROUTE)).toEqual({
      clipId: "c1",
      editUrl: "https://clips.twitch.tv/c1/edit",
    });
    expect(stub.calls.map((call) => [call.init?.method, call.url])).toEqual([
      ["POST", "https://api.twitch.tv/helix/clips?broadcaster_id=B1"],
    ]);
  });

  test("creates the clip with twitchCreateClip on the engine", async () => {
    const stub = fetchAnswering(500, null);
    const engine = fakeEngineRoute({ ok: true, body: CLIP });
    expect(await createClipOnTwitch(CALL, engine.route)).toEqual({
      clipId: "c1",
      editUrl: "https://clips.twitch.tv/c1/edit",
    });
    expect(engine.calls).toEqual([{ method: "twitchCreateClip", args: [] }]);
    expect(stub.calls).toHaveLength(0);
  });

  for (const [code, status] of [
    ["timeout", 504],
    ["failed", 502],
  ] as const) {
    test(`a clip that ends in ${code} is not resent`, async () => {
      const stub = fetchAnswering(202, JSON.stringify(CLIP));
      expect(
        await rejection(() => createClipOnTwitch(CALL, fakeEngineRoute({ ok: false, code, error: "?" }).route))
      ).toBe(`Twitch clip creation failed: ${status} `);
      expect(stub.calls).toHaveLength(0);
    });
  }

  test("a clip the engine could not send goes to Helix", async () => {
    const stub = fetchAnswering(202, JSON.stringify(CLIP));
    await createClipOnTwitch(CALL, fakeEngineRoute({ ok: false, code: "unavailable", error: "?" }).route);
    expect(stub.calls).toHaveLength(1);
  });

  for (const [status, body] of [
    [404, helixErrorBody(404, "Not live")],
    [403, helixErrorBody(403, "Clipping disabled")],
    [401, helixErrorBody(401, "Invalid OAuth token")],
    [429, helixErrorBody(429, "Too Many Requests")],
    [503, ""],
  ] as const) {
    test(`Twitch's ${status} reads the same on either path`, async () => {
      fetchAnswering(status, body || null);
      const direct = await rejection(() => createClipOnTwitch(CALL, DIRECT_ROUTE));
      fetchStub?.restore();
      const engine = fakeEngineRoute({ ok: false, code: "helix", error: "", status, body });
      expect(direct).not.toBeNull();
      expect(await rejection(() => createClipOnTwitch(CALL, engine.route))).toBe(direct);
    });
  }
});
