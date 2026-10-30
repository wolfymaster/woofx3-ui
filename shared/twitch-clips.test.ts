import { describe, expect, test } from "bun:test";
import { readCreatedClipAnswer } from "./twitch-clips";

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: Error) => error.message
  );

describe("readCreatedClipAnswer", () => {
  test("a clip is its id and edit link", async () => {
    const body = JSON.stringify({ data: [{ id: "c1", edit_url: "https://clips.twitch.tv/c1/edit" }] });
    expect(await readCreatedClipAnswer(new Response(body, { status: 202 }))).toEqual({
      clipId: "c1",
      editUrl: "https://clips.twitch.tv/c1/edit",
    });
  });

  const refusals: Array<{ status: number; body: string; message: string }> = [
    { status: 404, body: "", message: "Twitch has nothing to clip — the channel has to be live." },
    { status: 403, body: "", message: "Twitch refused the clip. Clipping may be disabled for this channel." },
    { status: 500, body: "boom", message: "Twitch clip creation failed: 500 boom" },
    { status: 200, body: '{"data":[]}', message: "Twitch accepted the request but returned no clip" },
  ];
  for (const { status, body, message } of refusals) {
    test(`a ${status} with ${JSON.stringify(body)} is refused`, async () => {
      expect(await failure(readCreatedClipAnswer(new Response(body || null, { status })))).toBe(message);
    });
  }
});
