import { describe, expect, test } from "bun:test";
import {
  announcementProblem,
  chatMessageProblem,
  readChatMessageAnswer,
  readChattersAnswer,
  readSentMessageIdAnswer,
  readShoutoutAnswer,
} from "./twitch-chat";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: Error) => error.message
  );

describe("chat refusals before a call", () => {
  test("a message or announcement needs text within Twitch's limit", () => {
    expect(chatMessageProblem("")).toBe("A chat message needs some text");
    expect(chatMessageProblem("x".repeat(501))).toContain("500 characters");
    expect(chatMessageProblem("hi")).toBeNull();
    expect(announcementProblem("")).toBe("An announcement needs a message");
    expect(announcementProblem("x".repeat(501))).toContain("500 characters");
  });
});

describe("send answers", () => {
  const cases: Array<{ name: string; response: () => Response; message: string | null }> = [
    { name: "sent", response: () => json({ data: [{ message_id: "m1", is_sent: true }] }), message: null },
    {
      name: "dropped with a reason",
      response: () => json({ data: [{ is_sent: false, drop_reason: { message: "Your message is being checked" } }] }),
      message: "Your message is being checked",
    },
    {
      name: "dropped without one",
      response: () => json({ data: [] }),
      message: "Twitch accepted the message but did not send it",
    },
    {
      name: "refused",
      response: () => new Response("nope", { status: 403 }),
      message: "Twitch chat message failed: 403 nope",
    },
  ];
  for (const { name, response, message } of cases) {
    test(`a message ${name}`, async () => {
      expect(await failure(readChatMessageAnswer(response()))).toBe(message);
    });
  }

  test("a send something needs the id of resolves with it, and refuses an answer without one", async () => {
    expect(await readSentMessageIdAnswer(json({ data: [{ message_id: "m1", is_sent: true }] }))).toBe("m1");
    expect(await failure(readSentMessageIdAnswer(json({ data: [{ is_sent: true }] })))).toBe(
      "Twitch sent the message but returned no id"
    );
    expect(await failure(readSentMessageIdAnswer(new Response("x", { status: 500 })))).toBe(
      "Twitch chat send failed: 500 x"
    );
  });

  test("a shoutout's 429 is Twitch's rate limit", async () => {
    expect(await failure(readShoutoutAnswer(new Response(null, { status: 429 })))).toContain("rate-limiting shoutouts");
    expect(await failure(readShoutoutAnswer(new Response("live", { status: 400 })))).toBe(
      "Twitch shoutout failed: 400 live"
    );
    expect(await failure(readShoutoutAnswer(new Response(null, { status: 204 })))).toBeNull();
  });
});

describe("readChattersAnswer", () => {
  test("names each chatter", async () => {
    const body = { data: [{ user_id: "1", user_login: "someone", user_name: "SomeOne" }] };
    expect(await readChattersAnswer(json(body))).toEqual([{ userId: "1", login: "someone", displayName: "SomeOne" }]);
  });
});
