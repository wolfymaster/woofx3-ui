import { describe, expect, test } from "bun:test";
import {
  canTriggerRemotely,
  decideTrigger,
  engineRefusalReason,
  fullRateBucket,
  generateTriggerToken,
  hasControlCharacter,
  hashTriggerToken,
  isBrowserRequest,
  isEngineTransportFailure,
  isWellFormedTriggerToken,
  MACRO_TRIGGER_PATH,
  MACRO_TRIGGER_PATH_PREFIX,
  MACRO_TRIGGER_RATE_LIMIT,
  MAX_VARIABLE_VALUE_LENGTH,
  macroBehaviorFingerprint,
  macroTriggerUrl,
  missingMacroVariables,
  parseChatCommand,
  parseMacroTriggerPath,
  parseTriggerValues,
  planMacroRun,
  type RateBucket,
  resolveTriggerToken,
  takeRateToken,
  triggerRefusalResponse,
} from "./macroTrigger";
import type { MacroActionType, MacroConfig } from "./macroVariables";

describe("generateTriggerToken", () => {
  test("is well formed", () => {
    expect(isWellFormedTriggerToken(generateTriggerToken())).toBe(true);
  });

  test("carries at least 128 bits: 43 base64url characters after the prefix", () => {
    const token = generateTriggerToken();
    const body = token.slice("wfxm_".length);
    expect(body).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("never repeats across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateTriggerToken());
    }
    expect(seen.size).toBe(1000);
  });
});

describe("hashTriggerToken", () => {
  test("is lowercase hex SHA-256", async () => {
    // SHA-256("abc"), the FIPS 180-2 test vector.
    expect(await hashTriggerToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("differs for different tokens and is stable for one", async () => {
    const token = generateTriggerToken();
    expect(await hashTriggerToken(token)).toBe(await hashTriggerToken(token));
    expect(await hashTriggerToken(token)).not.toBe(await hashTriggerToken(generateTriggerToken()));
  });
});

describe("parseMacroTriggerPath", () => {
  const token = generateTriggerToken();

  test("extracts a well-formed token", () => {
    expect(parseMacroTriggerPath(`${MACRO_TRIGGER_PATH_PREFIX}${token}`)).toBe(token);
  });

  test("refuses other paths, extra segments and malformed tokens alike", () => {
    expect(parseMacroTriggerPath(`/api/webhooks/${token}`)).toBeNull();
    expect(parseMacroTriggerPath(`${MACRO_TRIGGER_PATH_PREFIX}${token}/extra`)).toBeNull();
    expect(parseMacroTriggerPath(`${MACRO_TRIGGER_PATH_PREFIX}${token.slice(0, -1)}`)).toBeNull();
    expect(parseMacroTriggerPath(`${MACRO_TRIGGER_PATH_PREFIX}not-a-token`)).toBeNull();
    expect(parseMacroTriggerPath(MACRO_TRIGGER_PATH_PREFIX)).toBeNull();
  });

  test("round-trips through macroTriggerUrl, with or without a trailing slash on the site", () => {
    for (const site of ["https://x.convex.site", "https://x.convex.site/"]) {
      const url = new URL(macroTriggerUrl(site, token));
      expect(parseMacroTriggerPath(url.pathname)).toBe(token);
    }
  });
});

describe("takeRateToken", () => {
  const start = 1_000_000;

  test("allows a burst of five back to back, then refuses", () => {
    let bucket: RateBucket = fullRateBucket(start);
    for (let i = 0; i < MACRO_TRIGGER_RATE_LIMIT.burst; i++) {
      const decision = takeRateToken(bucket, start);
      expect(decision.allowed).toBe(true);
      bucket = decision.bucket;
    }
    const refused = takeRateToken(bucket, start);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterMs).toBe(1000);
    }
  });

  test("refills one token a second", () => {
    const empty: RateBucket = { tokens: 0, refilledAt: start };
    expect(takeRateToken(empty, start + 999).allowed).toBe(false);
    expect(takeRateToken(empty, start + 1000).allowed).toBe(true);
  });

  test("never refills past the burst", () => {
    const decision = takeRateToken({ tokens: 0, refilledAt: start }, start + 60_000);
    expect(decision.bucket.tokens).toBe(MACRO_TRIGGER_RATE_LIMIT.burst - 1);
  });

  test("a clock stepping backwards earns nothing", () => {
    const decision = takeRateToken({ tokens: 0.5, refilledAt: start }, start - 10_000);
    expect(decision.allowed).toBe(false);
    expect(decision.bucket.tokens).toBe(0.5);
  });

  test("a refused call still records the partial refill", () => {
    const decision = takeRateToken({ tokens: 0, refilledAt: start }, start + 400);
    expect(decision.allowed).toBe(false);
    expect(decision.bucket).toEqual({ tokens: 0.4, refilledAt: start + 400 });
    if (!decision.allowed) {
      expect(decision.retryAfterMs).toBe(600);
    }
  });

  test("rejects a nonsensical limit", () => {
    expect(() => takeRateToken(fullRateBucket(start), start, { perSecond: 0, burst: 5 })).toThrow();
  });
});

describe("parseTriggerValues", () => {
  const none = new URLSearchParams();

  test("an empty body and no query is no values", () => {
    expect(parseTriggerValues({ contentType: null, body: "", query: none })).toEqual({ ok: true, values: {} });
  });

  test("reads a JSON body whatever the content type says", () => {
    for (const contentType of ["application/json", "text/plain", null]) {
      expect(parseTriggerValues({ contentType, body: '{"channel":"bob"}', query: none })).toEqual({
        ok: true,
        values: { channel: "bob" },
      });
    }
  });

  test("stringifies numbers and booleans", () => {
    expect(parseTriggerValues({ contentType: null, body: '{"n":3,"b":true}', query: none })).toEqual({
      ok: true,
      values: { n: "3", b: "true" },
    });
  });

  test("reads a form body", () => {
    expect(
      parseTriggerValues({ contentType: "application/x-www-form-urlencoded", body: "channel=bob+ross", query: none })
    ).toEqual({ ok: true, values: { channel: "bob ross" } });
  });

  test("merges the query under the body", () => {
    const query = new URLSearchParams("channel=fromquery&extra=1");
    expect(parseTriggerValues({ contentType: null, body: '{"channel":"frombody"}', query })).toEqual({
      ok: true,
      values: { channel: "frombody", extra: "1" },
    });
  });

  test("ignores keys that could never name a variable", () => {
    expect(parseTriggerValues({ contentType: null, body: '{"has space":"x","ok":"y"}', query: none })).toEqual({
      ok: true,
      values: { ok: "y" },
    });
  });

  test("refuses malformed JSON, non-objects and nested values", () => {
    expect(parseTriggerValues({ contentType: null, body: "{nope", query: none }).ok).toBe(false);
    expect(parseTriggerValues({ contentType: null, body: '["a"]', query: none }).ok).toBe(false);
    expect(parseTriggerValues({ contentType: null, body: '{"a":{"b":1}}', query: none }).ok).toBe(false);
    expect(parseTriggerValues({ contentType: null, body: '{"a":null}', query: none }).ok).toBe(false);
  });

  test("refuses control characters in a body or query value", () => {
    expect(parseTriggerValues({ contentType: null, body: '{"a":"x\\ny"}', query: none }).ok).toBe(false);
    expect(parseTriggerValues({ contentType: null, body: "", query: new URLSearchParams("a=x%0Dy") }).ok).toBe(false);
  });

  test("refuses an overlong value", () => {
    const body = JSON.stringify({ a: "x".repeat(MAX_VARIABLE_VALUE_LENGTH + 1) });
    expect(parseTriggerValues({ contentType: null, body, query: none }).ok).toBe(false);
  });
});

describe("parseChatCommand", () => {
  test("splits the command word from the text", () => {
    expect(parseChatCommand("!so bob")).toEqual({ commandName: "so", text: "bob" });
    expect(parseChatCommand("  !hype  ")).toEqual({ commandName: "hype", text: "" });
    expect(parseChatCommand("!raid a b  c")).toEqual({ commandName: "raid", text: "a b  c" });
  });

  test("refuses a plain message or a bare !", () => {
    expect(parseChatCommand("hello chat")).toBeNull();
    expect(parseChatCommand("!")).toBeNull();
    expect(parseChatCommand("! so")).toBeNull();
    expect(parseChatCommand("")).toBeNull();
  });
});

describe("missingMacroVariables", () => {
  test("lists absent and blank values, in authored order", () => {
    expect(missingMacroVariables({ command: "!so {{channel}} {{reason}}" }, { reason: "  " })).toEqual([
      "channel",
      "reason",
    ]);
    expect(missingMacroVariables({ command: "!so {{channel}}" }, { channel: "bob" })).toEqual([]);
  });
});

describe("planMacroRun", () => {
  test("refuses a control character in a used variable, as the dashboard path must too", () => {
    const result = planMacroRun("chat-command", { command: "!so {{channel}}" }, { channel: "bob\r\n!ban x" });
    expect(result).toEqual({ ok: false, status: 400, error: "control characters are not allowed in: channel" });
  });

  test("plans a workflow run", () => {
    expect(planMacroRun("trigger-workflow", { workflowId: "wf-1" }, {})).toEqual({
      ok: true,
      plan: { kind: "trigger-workflow", workflowNameOrId: "wf-1" },
    });
  });

  test("refuses a workflow macro with nothing selected", () => {
    expect(planMacroRun("trigger-workflow", {}, {})).toMatchObject({ ok: false, status: 422 });
  });

  test("plans a chat command with its variables filled in", () => {
    expect(planMacroRun("chat-command", { command: "!so {{channel}}" }, { channel: "bob" })).toEqual({
      ok: true,
      plan: { kind: "chat-command", commandName: "so", text: "bob" },
    });
  });

  test("answers 400 naming every missing variable", () => {
    const result = planMacroRun("chat-command", { command: "!so {{channel}} {{reason}}" }, {});
    expect(result).toEqual({ ok: false, status: 400, error: "missing variables: channel, reason" });
  });

  test("refuses a chat command that is not a !command", () => {
    expect(planMacroRun("chat-command", { command: "hello chat" }, {})).toMatchObject({ ok: false, status: 422 });
  });

  test("plans a picked command word with its arguments in commandText", () => {
    expect(planMacroRun("chat-command", { command: "so", commandText: " {{channel}} " }, { channel: "bob" })).toEqual({
      ok: true,
      plan: { kind: "chat-command", commandName: "so", text: "bob" },
    });
  });

  test("refuses a picked command that is empty or more than one word", () => {
    expect(planMacroRun("chat-command", { command: "", commandText: "" }, {})).toMatchObject({
      ok: false,
      status: 422,
    });
    expect(planMacroRun("chat-command", { command: "so bob", commandText: "" }, {})).toMatchObject({
      ok: false,
      status: 422,
    });
  });

  test("refuses send-message macros", () => {
    expect(planMacroRun("send-message", { message: "hi" }, {})).toMatchObject({ ok: false, status: 422 });
  });

  test("refuses HTTP request macros before looking at their variables", () => {
    const result = planMacroRun("http-request", { url: "https://example.com/{{x}}", headers: { a: "secret" } }, {});
    expect(result).toMatchObject({ ok: false, status: 422 });
    if (!result.ok) {
      expect(result.error).not.toContain("secret");
    }
  });
});

describe("decideTrigger", () => {
  const now = 5_000_000;
  const workflowMacro = { type: "trigger-workflow" as const, config: { workflowId: "wf-1" } };
  const chatMacro = { type: "chat-command" as const, config: { command: "!so {{channel}}" } };
  const approvedFor = (macro: { type: MacroActionType; config: MacroConfig }) =>
    macroBehaviorFingerprint(macro.type, macro.config);
  const fullTrigger = (allowGet: boolean, macro: { type: MacroActionType; config: MacroConfig } = workflowMacro) => ({
    allowGet,
    bucket: fullRateBucket(now),
    confirmedFingerprint: approvedFor(macro),
    confirmerIsManager: true,
  });

  test("an unknown token and a deleted macro look the same", () => {
    expect(decideTrigger({ trigger: null, macro: workflowMacro, method: "POST", values: {}, now })).toEqual({
      outcome: "not-found",
    });
    expect(decideTrigger({ trigger: fullTrigger(false), macro: null, method: "POST", values: {}, now })).toEqual({
      outcome: "not-found",
    });
  });

  test("GET is refused unless opted in, without spending a rate token", () => {
    const decision = decideTrigger({
      trigger: fullTrigger(false),
      macro: workflowMacro,
      method: "GET",
      values: {},
      now,
    });
    expect(decision).toEqual({ outcome: "method-not-allowed" });
    expect(
      decideTrigger({ trigger: fullTrigger(true), macro: workflowMacro, method: "GET", values: {}, now }).outcome
    ).toBe("run");
  });

  test("runs and spends a token", () => {
    const decision = decideTrigger({
      trigger: fullTrigger(false),
      macro: workflowMacro,
      method: "POST",
      values: {},
      now,
    });
    expect(decision).toEqual({
      outcome: "run",
      plan: { kind: "trigger-workflow", workflowNameOrId: "wf-1" },
      bucket: { tokens: MACRO_TRIGGER_RATE_LIMIT.burst - 1, refilledAt: now },
    });
  });

  test("an empty bucket is rate limited", () => {
    const decision = decideTrigger({
      trigger: { ...fullTrigger(false), bucket: { tokens: 0, refilledAt: now } },
      macro: workflowMacro,
      method: "POST",
      values: {},
      now,
    });
    expect(decision.outcome).toBe("rate-limited");
  });

  test("a bad request still spends its token, so a spammer cannot probe for free", () => {
    const decision = decideTrigger({
      trigger: fullTrigger(false, chatMacro),
      macro: chatMacro,
      method: "POST",
      values: {},
      now,
    });
    expect(decision).toMatchObject({ outcome: "refused", status: 400 });
    expect("bucket" in decision && decision.bucket.tokens).toBe(MACRO_TRIGGER_RATE_LIMIT.burst - 1);
  });

  test("a macro edited since the URL was approved is refused with 409", () => {
    const edited = { type: "chat-command" as const, config: { command: "!ban {{channel}}" } };
    const decision = decideTrigger({
      trigger: fullTrigger(false, chatMacro),
      macro: edited,
      method: "POST",
      values: { channel: "bob" },
      now,
    });
    expect(decision).toMatchObject({ outcome: "refused", status: 409 });
    if (decision.outcome === "refused") {
      expect(decision.error).toContain("re-confirm");
    }
  });

  test("an approver who lost the owner or admin role stops the URL with 409", () => {
    const decision = decideTrigger({
      trigger: { ...fullTrigger(false), confirmerIsManager: false },
      macro: workflowMacro,
      method: "POST",
      values: {},
      now,
    });
    expect(decision).toMatchObject({ outcome: "refused", status: 409 });
  });

  test("a control character in a value is refused with 400", () => {
    const decision = decideTrigger({
      trigger: fullTrigger(false, chatMacro),
      macro: chatMacro,
      method: "POST",
      values: { channel: "bob\n!ban alice" },
      now,
    });
    expect(decision).toMatchObject({ outcome: "refused", status: 400 });
  });
});

describe("macroBehaviorFingerprint", () => {
  test("ignores key order and undefined fields", () => {
    expect(macroBehaviorFingerprint("http-request", { url: "u", method: "POST", headers: { b: "2", a: "1" } })).toBe(
      macroBehaviorFingerprint("http-request", {
        headers: { a: "1", b: "2" },
        method: "POST",
        url: "u",
        body: undefined,
      })
    );
  });

  test("changes with the type or any config value", () => {
    const base = macroBehaviorFingerprint("chat-command", { command: "!so" });
    expect(macroBehaviorFingerprint("chat-command", { command: "!ban" })).not.toBe(base);
    expect(macroBehaviorFingerprint("trigger-workflow", { command: "!so" })).not.toBe(base);
  });
});

describe("resolveTriggerToken", () => {
  const token = generateTriggerToken();
  const other = generateTriggerToken();

  test("takes the token from the path", () => {
    expect(resolveTriggerToken(`${MACRO_TRIGGER_PATH_PREFIX}${token}`, null)).toBe(token);
  });

  test("takes the token from a Bearer header on the bare path, with or without a trailing slash", () => {
    expect(resolveTriggerToken(MACRO_TRIGGER_PATH, `Bearer ${token}`)).toBe(token);
    expect(resolveTriggerToken(MACRO_TRIGGER_PATH_PREFIX, `bearer ${token}`)).toBe(token);
  });

  test("accepts both when they agree and refuses when they do not", () => {
    expect(resolveTriggerToken(`${MACRO_TRIGGER_PATH_PREFIX}${token}`, `Bearer ${token}`)).toBe(token);
    expect(resolveTriggerToken(`${MACRO_TRIGGER_PATH_PREFIX}${token}`, `Bearer ${other}`)).toBeNull();
  });

  test("refuses no token, a malformed header and a malformed path", () => {
    expect(resolveTriggerToken(MACRO_TRIGGER_PATH, null)).toBeNull();
    expect(resolveTriggerToken(MACRO_TRIGGER_PATH, token)).toBeNull();
    expect(resolveTriggerToken(MACRO_TRIGGER_PATH, "Bearer nope")).toBeNull();
    expect(resolveTriggerToken(`${MACRO_TRIGGER_PATH_PREFIX}nope`, `Bearer ${token}`)).toBeNull();
  });
});

describe("isBrowserRequest", () => {
  test("any Origin marks a browser; none or empty does not", () => {
    expect(isBrowserRequest("https://evil.example")).toBe(true);
    expect(isBrowserRequest("null")).toBe(true);
    expect(isBrowserRequest(null)).toBe(false);
    expect(isBrowserRequest("")).toBe(false);
  });
});

describe("hasControlCharacter", () => {
  test("flags C0 controls and DEL, not ordinary text", () => {
    expect(hasControlCharacter("a\nb")).toBe(true);
    expect(hasControlCharacter("a\u0000")).toBe(true);
    expect(hasControlCharacter("a\u007f")).toBe(true);
    expect(hasControlCharacter("bob ross é 🙂")).toBe(false);
  });
});

describe("engine errors", () => {
  test("transport failures are told apart from the engine's refusals", () => {
    expect(isEngineTransportFailure(new TypeError("fetch failed"))).toBe(true);
    expect(isEngineTransportFailure(new Error("RPC request failed: 502 Bad Gateway"))).toBe(true);
    expect(isEngineTransportFailure(new Error("bad RPC message: {}"))).toBe(true);
    expect(isEngineTransportFailure("boom")).toBe(true);
    expect(isEngineTransportFailure(new Error("Command is disabled"))).toBe(false);
    expect(isEngineTransportFailure(new Error('You do not have permission to use "ban"'))).toBe(false);
  });

  test("a refusal reason is trimmed and bounded", () => {
    expect(engineRefusalReason(new Error("  Command is disabled "))).toBe("Command is disabled");
    expect(engineRefusalReason(new Error(""))).toBe("the engine refused the command");
    expect(engineRefusalReason(new Error("x".repeat(500))).length).toBe(203);
  });
});

describe("triggerRefusalResponse", () => {
  test("maps each refusal to its status", () => {
    expect(triggerRefusalResponse({ outcome: "not-found" }).status).toBe(404);
    expect(triggerRefusalResponse({ outcome: "browser-origin" }).status).toBe(403);
    expect(triggerRefusalResponse({ outcome: "method-not-allowed" })).toMatchObject({
      status: 405,
      headers: { Allow: "POST" },
    });
    expect(triggerRefusalResponse({ outcome: "refused", status: 400, error: "missing variables: a" })).toEqual({
      status: 400,
      body: { ok: false, error: "missing variables: a" },
      headers: {},
    });
  });

  test("rounds Retry-After up to whole seconds, never below one", () => {
    expect(triggerRefusalResponse({ outcome: "rate-limited", retryAfterMs: 1 }).headers["Retry-After"]).toBe("1");
    expect(triggerRefusalResponse({ outcome: "rate-limited", retryAfterMs: 1001 }).headers["Retry-After"]).toBe("2");
  });
});

describe("canTriggerRemotely", () => {
  test("allows only the types Convex can run without a signed-in user", () => {
    expect(canTriggerRemotely("chat-command")).toBe(true);
    expect(canTriggerRemotely("trigger-workflow")).toBe(true);
    expect(canTriggerRemotely("http-request")).toBe(false);
    expect(canTriggerRemotely("send-message")).toBe(false);
  });
});
