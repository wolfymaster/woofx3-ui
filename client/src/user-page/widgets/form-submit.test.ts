import { describe, expect, test } from "bun:test";
import { FORM_REFUSAL_CODES, USER_PAGE_LIMITS } from "@shared/user-pages";
import { turnstileSiteKey } from "../viewer/config";
import { formFailureCopy, formSubmitUrl, postFormSubmission } from "./form-submit";

const REQUEST = { slug: "wolfy", formId: "f", idempotencyKey: "k".repeat(43), answers: { a: "b" } };
const URL_ = "https://woofx3.tv/u/_/forms/submit";

function answering(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("postFormSubmission", () => {
  test("posts the request to the edge and reads success", async () => {
    let sent: { url: unknown; body: unknown; method: unknown } | undefined;
    const send = (async (url: unknown, init: RequestInit) => {
      sent = { url, body: init.body, method: init.method };
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    expect(await postFormSubmission(URL_, REQUEST, send)).toEqual({ ok: true });
    expect(sent).toEqual({ url: URL_, body: JSON.stringify(REQUEST), method: "POST" });
  });

  test.each([
    ["a refusal's code", 409, JSON.stringify({ error: { code: "form_stale", message: "" } }), "form_stale"],
    ["the edge's limit, whatever its code", 429, JSON.stringify({ error: { code: "x", message: "" } }), "rate_limited"],
    ["the edge's size limit", 413, "too big", "too_large"],
    [
      "the edge not configured",
      503,
      JSON.stringify({ error: { code: "not_configured", message: "" } }),
      "not_configured",
    ],
    ["an unknown code", 500, JSON.stringify({ error: { code: "new_thing", message: "" } }), "internal"],
    ["a body that isn't JSON", 502, "<html>", "internal"],
    ["a 200 that doesn't say ok", 200, "{}", "internal"],
  ])("reads %s", async (_name, status, body, failure) => {
    expect(await postFormSubmission(URL_, REQUEST, answering(status, body))).toEqual({ ok: false, failure } as never);
  });

  test("a network failure is its own failure", async () => {
    const send = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await postFormSubmission(URL_, REQUEST, send)).toEqual({ ok: false, failure: "network" });
  });

  test("answers past the size limit are not sent", async () => {
    const send = (async () => {
      throw new Error("should not send");
    }) as unknown as typeof fetch;
    const answers = { a: "x".repeat(USER_PAGE_LIMITS.formSubmissionBytes) };
    expect(await postFormSubmission(URL_, { ...REQUEST, answers }, send)).toEqual({ ok: false, failure: "too_large" });
  });
});

test("formSubmitUrl is on the edge, under the page's base", () => {
  expect(formSubmitUrl("https://woofx3.tv", "/u/")).toBe(URL_);
});

test("every failure has copy for the visitor", () => {
  for (const code of [...FORM_REFUSAL_CODES, "network" as const]) {
    expect(formFailureCopy(code).message.length).toBeGreaterThan(0);
  }
  expect(formFailureCopy("form_stale").action).toBe("reload");
  expect(formFailureCopy("session_expired").action).toBe("sign_in");
  expect(formFailureCopy("not_accepting").message).toBe("This form isn't accepting answers right now.");
});

describe("turnstileSiteKey", () => {
  test("is null when unset or blank", () => {
    expect(turnstileSiteKey(undefined)).toBeNull();
    expect(turnstileSiteKey("")).toBeNull();
  });
  test("passes a key through", () => {
    expect(turnstileSiteKey("0x4AAAAAAA_b-c")).toBe("0x4AAAAAAA_b-c");
  });
  test.each([["has spaces"], ["<script>"], [5]])("fails on %s", (value) => {
    expect(() => turnstileSiteKey(value)).toThrow();
  });
});
