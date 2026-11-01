import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  defaultPageContent,
  type FormField,
  type PageContent,
  type PageSection,
  type PublicPageLookup,
  type SectionVisibility,
  USER_PAGE_LIMITS,
} from "@shared/user-pages";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { EngineTimeoutError } from "./lib/inboundWebhookRelay";
import { generateOpaqueToken, hashOpaqueToken } from "./lib/oauthHandoff";
import { TURNSTILE_SECRET_ENV } from "./lib/turnstile";
import { stubFetch } from "./lib/twitchEngineHelix.fakes";
import {
  classifyDeliveryError,
  type DeliveryRunner,
  runDeliveryPass,
  type SubmissionTransport,
} from "./lib/userPageFormDelivery";
import { refreshPageStateSettings } from "./lib/userPageState";
import { backoffDelayMs, SUBMISSION_DELIVERY } from "./lib/userPageSubmissions";
import { type Fixture, fixture } from "./lib/userPages.fixtures";
import { EDGE_SECRET_ENV, EDGE_SECRET_HEADER, EDGE_SECRET_NEXT_ENV } from "./lib/viewerEdgeGate";
import { logger } from "./logger";
import { FORM_SUBMIT_PATH, parseSubmitBody } from "./userPageFormsHttp";

const EDGE_SECRET = "s".repeat(43);
const NEXT_SECRET = "n".repeat(43);
const BROADCASTER = "B1";

const FIELDS: FormField[] = [
  { id: "song", type: "text", label: "Song", required: true, maxLength: 20 },
  { id: "mood", type: "select", label: "Mood", required: false, options: [{ value: "hype", label: "Hype" }] },
  { id: "ok", type: "checkbox", label: "I follow", required: false },
];
const ANSWERS = { song: "Never", mood: "hype", ok: true };

const FORM = "woofx3:form:requests";

function formSection(visibility: SectionVisibility = { kind: "public" }): PageSection {
  return {
    id: "requests",
    region: "main",
    visibility,
    widgets: [{ id: "form1", type: "form", config: { resource: FORM } }],
  };
}

/** Writes the form as the mirror does, so a published page follows it the way it follows a real edit. */
async function setForm(f: Fixture, fields: FormField[], title = "Requests"): Promise<void> {
  const settings = { title, submitLabel: "Send", fields };
  await f.t.run(async (ctx) => {
    const existing = await ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_instance_canonical", (q) => q.eq("instanceId", f.instanceId).eq("canonicalId", FORM))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { settings });
    } else {
      const module = await ctx.db.query("moduleRepository").first();
      if (!module) {
        throw new Error("fixture has no module");
      }
      await ctx.db.insert("moduleResourceInstances", {
        instanceId: f.instanceId,
        moduleId: module._id,
        engineInstanceId: "uuid-form",
        resourceInstanceId: "requests",
        moduleName: "woofx3",
        kind: "form",
        displayName: "Requests",
        canonicalId: FORM,
        settings,
      });
    }
    await refreshPageStateSettings(ctx, f.instanceId, FORM, settings);
  });
}

function withSections(sections: PageSection[]): PageContent {
  return { ...defaultPageContent(), sections };
}

async function publish(f: Fixture, page: PageContent): Promise<void> {
  const before = await f.owner.query(api.userPages.forEditing, { instanceId: f.instanceId });
  const { revision } = await f.owner.mutation(api.userPages.saveDraft, {
    instanceId: f.instanceId,
    baseRevision: before?.draft.revision ?? 0,
    content: page,
  });
  await f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision });
}

async function formFixture(section: PageSection = formSection()): Promise<Fixture> {
  const f = await fixture();
  await setForm(f, FIELDS);
  await publish(f, withSections([section]));
  return f;
}

function submitBody(overrides: Record<string, unknown> = {}) {
  return { slug: "wolfy", widgetId: "form1", idempotencyKey: generateOpaqueToken(), answers: ANSWERS, ...overrides };
}

function post(f: Fixture, body: unknown, secret: string | null = EDGE_SECRET): Promise<Response> {
  return f.t.fetch(FORM_SUBMIT_PATH, {
    method: "POST",
    headers: secret === null ? {} : { [EDGE_SECRET_HEADER]: secret },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function refusal(response: Response): Promise<{ status: number; code: string }> {
  const body = (await response.json()) as { error: { code: string } };
  return { status: response.status, code: body.error.code };
}

async function rows(f: Fixture): Promise<Doc<"pageSubmissions">[]> {
  return f.t.run((ctx) => ctx.db.query("pageSubmissions").collect());
}

async function queueOf(f: Fixture): Promise<Doc<"pageSubmissionQueues"> | null> {
  return f.t.run((ctx) => ctx.db.query("pageSubmissionQueues").first());
}

async function signIn(f: Fixture, roles?: { follower: boolean; subscriberTier: 1 | 2 | 3 | null }): Promise<string> {
  const sessionToken = generateOpaqueToken();
  const tokenHash = await hashOpaqueToken(sessionToken);
  await f.t.run(async (ctx) => {
    const viewerId = await ctx.db.insert("viewers", {
      platform: "twitch",
      platformUserId: "V1",
      login: "viewer",
      displayName: "Viewer",
      updatedAt: 1,
    });
    await ctx.db.insert("viewerSessions", { tokenHash, viewerId, origin: "https://woofx3.tv", expiresAt: 1 });
    await ctx.db.insert("platformLinks", {
      instanceId: f.instanceId,
      platform: "twitch",
      platformUserId: BROADCASTER,
      platformUsername: "wolfy",
      channelId: BROADCASTER,
      sealedAccessToken: "p1.unused.streamer-access",
      sealedRefreshToken: "p1.unused.streamer-refresh",
      expiresAt: 1,
      scopes: [],
    });
    if (roles) {
      await ctx.db.insert("viewerRoles", {
        viewerId,
        platform: "twitch",
        broadcasterPlatformUserId: BROADCASTER,
        checkedAt: 1,
        ...roles,
      });
    }
  });
  return sessionToken;
}

let turnstile: ReturnType<typeof stubFetch>;
let turnstileAnswer: () => Response;
const savedEnv: Record<string, string | undefined> = {};
const ENV_NAMES = [EDGE_SECRET_ENV, EDGE_SECRET_NEXT_ENV, TURNSTILE_SECRET_ENV];

beforeEach(() => {
  for (const name of ENV_NAMES) {
    savedEnv[name] = process.env[name];
  }
  process.env[EDGE_SECRET_ENV] = EDGE_SECRET;
  delete process.env[EDGE_SECRET_NEXT_ENV];
  process.env[TURNSTILE_SECRET_ENV] = "turnstile-secret";
  turnstileAnswer = () => Response.json({ success: true });
  turnstile = stubFetch(() => turnstileAnswer());
  spyOn(logger, "warn").mockImplementation(() => {});
  spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  turnstile.restore();
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnv[name];
    }
  }
});

describe("edge gate on the submit route", () => {
  test.each([
    ["no header", null],
    ["a wrong secret", "x".repeat(43)],
  ])("refuses %s", async (_name, secret) => {
    const f = await formFixture();
    expect(await refusal(await post(f, submitBody({ turnstileToken: "t" }), secret))).toEqual({
      status: 401,
      code: "unauthorized",
    });
    expect(await rows(f)).toHaveLength(0);
  });

  test("answers 503 when the deployment has no secret", async () => {
    const f = await formFixture();
    delete process.env[EDGE_SECRET_ENV];
    expect(await refusal(await post(f, submitBody(), EDGE_SECRET))).toEqual({ status: 503, code: "not_configured" });
  });

  test("accepts the next secret while one rotates", async () => {
    const f = await formFixture();
    process.env[EDGE_SECRET_NEXT_ENV] = NEXT_SECRET;
    expect((await post(f, submitBody({ turnstileToken: "t" }), NEXT_SECRET)).status).toBe(200);
  });
});

describe("reading the body", () => {
  test.each([
    ["not JSON", "{"],
    ["a list", "[]"],
    ["a bad key", { ...submitBody(), idempotencyKey: "short" }],
    ["answers that aren't a map", { ...submitBody(), answers: ["a"] }],
    ["an answer that is a number", { ...submitBody(), answers: { song: 1 } }],
    ["a lone surrogate", { ...submitBody(), answers: { song: "\ud800" } }],
    ["a NUL", { ...submitBody(), answers: { song: "a\0" } }],
  ])("refuses %s", async (_name, body) => {
    const f = await formFixture();
    expect(await refusal(await post(f, body))).toEqual({ status: 400, code: "invalid_request" });
  });

  test("refuses a body over the limit", async () => {
    const f = await formFixture();
    const answers = { song: "x".repeat(USER_PAGE_LIMITS.formSubmissionBytes) };
    expect(await refusal(await post(f, submitBody({ answers })))).toEqual({ status: 413, code: "too_large" });
  });

  test("answer ids Convex field names could not hold stay plain data", () => {
    const parsed = parseSubmitBody(submitBody({ answers: { $bad: "a", _worse: true } }));
    expect(parsed?.answers).toEqual([
      { id: "$bad", value: "a" },
      { id: "_worse", value: true },
    ]);
  });
});

describe("submitting", () => {
  test("a valid anonymous submit queues a snapshot and wakes delivery", async () => {
    const f = await formFixture();
    const response = await post(f, submitBody({ turnstileToken: "t" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const [row] = await rows(f);
    expect(row.status).toBe("pending");
    expect(row.viewer).toBeNull();
    expect(row.formTitle).toBe("Requests");
    expect(row.fields).toEqual([
      { id: "song", label: "Song", type: "text", value: "Never" },
      { id: "mood", label: "Mood", type: "select", value: "hype" },
      { id: "ok", label: "I follow", type: "checkbox", value: true },
    ]);
    expect((await queueOf(f))?.pendingCount).toBe(1);
    const scheduled = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((job) => job.name.includes("deliverInstance"))).toBe(true);
  });

  test("a later edit of the form does not change a queued snapshot", async () => {
    const f = await formFixture();
    await post(f, submitBody({ turnstileToken: "t" }));
    const renamed = FIELDS.map((field) => ({ ...field, label: `${field.label} (new)` }));
    await setForm(f, renamed);
    expect((await rows(f))[0].fields[0].label).toBe("Song");
  });

  test("a delivered row names the form by canonical id, not its place on the page", async () => {
    const f = await formFixture();
    await post(f, submitBody({ turnstileToken: "t" }));
    expect((await rows(f))[0].formId).toBe(FORM);
  });

  test("a form whose stored settings break the rules takes no answers", async () => {
    const f = await formFixture();
    await setForm(
      f,
      FIELDS.map((field) => ({ ...field, label: `${field.label}\0` }))
    );
    expect(await refusal(await post(f, submitBody({ turnstileToken: "t" })))).toEqual({
      status: 409,
      code: "form_stale",
    });
  });

  test("a deleted form takes no answers and reads as unavailable", async () => {
    const f = await formFixture();
    await f.t.mutation(internal.moduleResourceInstances.deleteFromWebhook, {
      instanceId: f.instanceId,
      instance: {
        id: "uuid-form",
        moduleId: "m",
        moduleName: "woofx3",
        kind: "form",
        instanceId: "requests",
        displayName: "Requests",
        canonicalId: FORM,
        moduleKey: "",
      },
    });
    expect(await refusal(await post(f, submitBody({ turnstileToken: "t" })))).toEqual({
      status: 409,
      code: "form_stale",
    });
    const lookup = await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy" });
    if (lookup.kind !== "page" || lookup.sections[0].kind !== "open") {
      throw new Error("expected an open section");
    }
    expect(lookup.sections[0].widgets[0]).toMatchObject({ type: "form", form: null });
  });

  test("the public page carries the definition and no canonical id", async () => {
    const f = await formFixture();
    const lookup = await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy" });
    if (lookup.kind !== "page" || lookup.sections[0].kind !== "open") {
      throw new Error("expected an open section");
    }
    expect(lookup.sections[0].widgets[0]).toMatchObject({ id: "form1", form: { title: "Requests", fields: FIELDS } });
    expect(JSON.stringify(lookup)).not.toContain(FORM);
  });

  test("a repeated key returns ok, writes one row and spends no second check", async () => {
    const f = await formFixture();
    const body = submitBody({ turnstileToken: "t" });
    expect((await post(f, body)).status).toBe(200);
    const checks = turnstile.calls.filter((call) => call.url.includes("siteverify")).length;
    expect((await post(f, body)).status).toBe(200);
    expect(await rows(f)).toHaveLength(1);
    expect((await queueOf(f))?.pendingCount).toBe(1);
    expect(turnstile.calls.filter((call) => call.url.includes("siteverify"))).toHaveLength(checks);
  });

  test("a repeat is answered the same after the form has gone", async () => {
    const f = await formFixture();
    const body = submitBody({ turnstileToken: "t" });
    await post(f, body);
    await publish(f, withSections([]));
    expect((await post(f, body)).status).toBe(200);
    expect(await rows(f)).toHaveLength(1);
  });

  test("the mutation itself makes one row of a repeat", async () => {
    const f = await formFixture();
    const attempt = {
      slug: "wolfy",
      widgetId: "form1",
      idempotencyKey: generateOpaqueToken(),
      answers: Object.entries(ANSWERS).map(([id, value]) => ({ id, value })),
      sessionToken: null,
      humanVerified: true,
    };
    const results = await Promise.all([
      f.t.mutation(internal.userPageForms.acceptSubmission, attempt),
      f.t.mutation(internal.userPageForms.acceptSubmission, attempt),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(["accepted", "repeat"]);
    expect(await rows(f)).toHaveLength(1);
  });

  test.each([
    ["the widget is gone", "other", ANSWERS],
    ["a question was added", "form1", { song: "Never", ok: true }],
    ["a question was removed", "form1", { ...ANSWERS, gone: "x" }],
    ["a question changed type", "form1", { ...ANSWERS, ok: "yes" }],
    ["a choice is no longer offered", "form1", { ...ANSWERS, mood: "sad" }],
  ])("refuses as stale when %s", async (_name, widgetId, answers) => {
    const f = await formFixture();
    expect(await refusal(await post(f, submitBody({ widgetId, answers, turnstileToken: "t" })))).toEqual({
      status: 409,
      code: "form_stale",
    });
    expect(await rows(f)).toHaveLength(0);
    expect(turnstile.calls).toHaveLength(0);
  });

  test.each([
    ["a required answer is blank", { ...ANSWERS, song: "  " }],
    ["an answer is too long", { ...ANSWERS, song: "x".repeat(21) }],
  ])("refuses as invalid when %s", async (_name, answers) => {
    const f = await formFixture();
    expect(await refusal(await post(f, submitBody({ answers, turnstileToken: "t" })))).toEqual({
      status: 422,
      code: "invalid_answers",
    });
  });

  test("a repeat is answered the same after the page goes offline", async () => {
    const f = await formFixture();
    const body = submitBody({ turnstileToken: "t" });
    await post(f, body);
    await f.owner.mutation(api.userPages.unpublish, { instanceId: f.instanceId });
    expect((await post(f, body)).status).toBe(200);
  });

  test("a page taken offline refuses", async () => {
    const f = await formFixture();
    await f.owner.mutation(api.userPages.unpublish, { instanceId: f.instanceId });
    expect(await refusal(await post(f, submitBody({ turnstileToken: "t" })))).toEqual({
      status: 404,
      code: "page_unavailable",
    });
  });
});

describe("gating and identity", () => {
  test("an anonymous visitor can't send a form in a locked section", async () => {
    const f = await formFixture(formSection({ kind: "signed_in" }));
    expect(await refusal(await post(f, submitBody({ turnstileToken: "t" })))).toEqual({
      status: 403,
      code: "section_locked",
    });
    expect(await rows(f)).toHaveLength(0);
  });

  test("a viewer without the role can't send a form in its section", async () => {
    const f = await formFixture(formSection({ kind: "subscriber" }));
    const sessionToken = await signIn(f, { follower: true, subscriberTier: null });
    expect(await refusal(await post(f, submitBody({ sessionToken })))).toEqual({ status: 403, code: "section_locked" });
  });

  test("a viewer whose roles are unknown is refused, not trusted", async () => {
    const f = await formFixture(formSection({ kind: "follower" }));
    const sessionToken = await signIn(f);
    expect(await refusal(await post(f, submitBody({ sessionToken })))).toEqual({ status: 403, code: "section_locked" });
  });

  test("a signed-in submit needs no check and takes identity only from the session", async () => {
    const f = await formFixture(formSection({ kind: "subscriber" }));
    const sessionToken = await signIn(f, { follower: true, subscriberTier: 2 });
    const body = submitBody({
      sessionToken,
      viewer: { platform: "twitch", platformUserId: "forged", displayName: "Forged", roles: ["mod"] },
    });
    expect((await post(f, body)).status).toBe(200);
    expect((await rows(f))[0].viewer).toEqual({
      platform: "twitch",
      platformUserId: "V1",
      displayName: "Viewer",
      roles: ["follower", "subscriber", "subscriber_tier_2"],
    });
    expect(turnstile.calls).toHaveLength(0);
  });

  test("the viewer's name is cleaned and cut to what the engine takes", async () => {
    const f = await formFixture();
    const sessionToken = await signIn(f);
    await f.t.run(async (ctx) => {
      const viewer = await ctx.db.query("viewers").first();
      if (viewer) {
        await ctx.db.patch(viewer._id, { displayName: `a\0${"b".repeat(300)}` });
      }
    });
    expect((await post(f, submitBody({ sessionToken }))).status).toBe(200);
    const name = (await rows(f))[0].viewer?.displayName ?? "";
    expect(name.startsWith("ab")).toBe(true);
    expect(name.includes("\0")).toBe(false);
    expect(name).toHaveLength(USER_PAGE_LIMITS.deliveredTextLength);
  });

  test.each([
    ["too long", "x".repeat(USER_PAGE_LIMITS.deliveredPlatformUserIdLength + 1)],
    ["with a NUL", "a\0"],
    ["empty", ""],
  ])("a platform id the engine would refuse is never queued: %s", async (_name, platformUserId) => {
    const f = await formFixture();
    const sessionToken = await signIn(f);
    await f.t.run(async (ctx) => {
      const viewer = await ctx.db.query("viewers").first();
      if (viewer) {
        await ctx.db.patch(viewer._id, { platformUserId });
      }
    });
    expect(await refusal(await post(f, submitBody({ sessionToken })))).toEqual({ status: 500, code: "internal" });
    expect(await rows(f)).toHaveLength(0);
  });

  test("a token that signs nobody in is told so", async () => {
    const f = await formFixture();
    expect(await refusal(await post(f, submitBody({ sessionToken: generateOpaqueToken() })))).toEqual({
      status: 401,
      code: "session_expired",
    });
  });

  test("a signed-in viewer is limited per viewer", async () => {
    const f = await formFixture();
    const sessionToken = await signIn(f);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await post(f, submitBody({ sessionToken }))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(await rows(f)).toHaveLength(5);
  });
});

describe("Turnstile", () => {
  test("a missing token is refused without asking Cloudflare", async () => {
    const f = await formFixture();
    expect(await refusal(await post(f, submitBody()))).toEqual({ status: 403, code: "verification_failed" });
    expect(turnstile.calls).toHaveLength(0);
  });

  test("a refused token writes nothing", async () => {
    const f = await formFixture();
    turnstileAnswer = () => Response.json({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await refusal(await post(f, submitBody({ turnstileToken: "t" })))).toEqual({
      status: 403,
      code: "verification_failed",
    });
    expect(await rows(f)).toHaveLength(0);
  });

  test("Cloudflare not answering is not the visitor's fault, and writes nothing", async () => {
    const f = await formFixture();
    turnstileAnswer = () => {
      throw new TypeError("fetch failed");
    };
    expect(await refusal(await post(f, submitBody({ turnstileToken: "t" })))).toEqual({
      status: 503,
      code: "verification_unavailable",
    });
    expect(await rows(f)).toHaveLength(0);
  });

  test("with no secret anonymous submits are refused and shown closed; signed-in ones still work", async () => {
    const f = await formFixture();
    delete process.env[TURNSTILE_SECRET_ENV];
    expect(await refusal(await post(f, submitBody({ turnstileToken: "t" })))).toEqual({
      status: 503,
      code: "verification_unconfigured",
    });
    expect(formAccepting(await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy" }))).toBe(false);

    const sessionToken = await signIn(f);
    expect(formAccepting(await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy", sessionToken }))).toBe(true);
    expect((await post(f, submitBody({ sessionToken }))).status).toBe(200);
  });

  test("the mutation refuses an anonymous submit the route did not verify", async () => {
    const f = await formFixture();
    const result = await f.t.mutation(internal.userPageForms.acceptSubmission, {
      slug: "wolfy",
      widgetId: "form1",
      idempotencyKey: generateOpaqueToken(),
      answers: Object.entries(ANSWERS).map(([id, value]) => ({ id, value })),
      sessionToken: null,
      humanVerified: false,
    });
    expect(result).toEqual({ kind: "refused", code: "verification_failed" });
  });
});

function formAccepting(lookup: PublicPageLookup): boolean {
  if (lookup.kind !== "page") {
    throw new Error(`expected a page, got ${lookup.kind}`);
  }
  const section = lookup.sections[0];
  if (section.kind !== "open") {
    throw new Error("expected an open section");
  }
  const widget = section.widgets[0];
  if (widget.type !== "form") {
    throw new Error("expected a form");
  }
  return widget.accepting;
}

// ---------------------------------------------------------------------------
// Delivery: rows are seeded directly, so no scheduled pass runs against the
// real transport while a test drives one with a fake.
// ---------------------------------------------------------------------------

async function pageIdOf(f: Fixture): Promise<Id<"userPages">> {
  const page = await f.t.run((ctx) => ctx.db.query("userPages").first());
  if (!page) {
    throw new Error("fixture has no page");
  }
  return page._id;
}

async function seedPending(f: Fixture, count: number): Promise<Id<"pageSubmissions">[]> {
  const pageId = await pageIdOf(f);
  return f.t.run(async (ctx) => {
    await ctx.db.patch(f.instanceId, { clientId: "client", clientSecret: "secret" });
    const now = Date.now();
    const ids: Id<"pageSubmissions">[] = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(
        await ctx.db.insert("pageSubmissions", {
          instanceId: f.instanceId,
          pageId,
          formId: FORM,
          idempotencyKey: `seeded-key-${i}-aaaaaaaa`,
          submittedAt: now - 1000 + i,
          viewer: null,
          fields: [{ id: "song", label: "Song", type: "text", value: String(i) }],
          status: "pending",
          attempts: 0,
          nextAttemptAt: now - 1000 + i,
        })
      );
    }
    await ctx.db.insert("pageSubmissionQueues", {
      instanceId: f.instanceId,
      pageId,
      pendingCount: count,
      nextAttemptAt: now - 1000,
      consecutiveFailures: 0,
    });
    return ids;
  });
}

function runner(f: Fixture): DeliveryRunner {
  return {
    runMutation: ((ref: Parameters<Fixture["t"]["mutation"]>[0], args: never) => f.t.mutation(ref, args)) as never,
  };
}

function transportWith(
  deliver: SubmissionTransport["deliver"],
  canDeliver: SubmissionTransport["canDeliver"] = async () => true
): SubmissionTransport & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    canDeliver,
    deliver: (engine, delivery) => {
      sent.push(delivery.submissionId);
      return deliver(engine, delivery);
    },
  };
}

const RECORDED = async () => "recorded" as const;

describe("delivery", () => {
  test("a receipt marks each row delivered and empties the queue", async () => {
    const f = await formFixture();
    const ids = await seedPending(f, 2);
    const transport = transportWith(RECORDED);
    await runDeliveryPass(runner(f), f.instanceId, transport);
    expect(transport.sent).toEqual(ids);
    const after = await rows(f);
    expect(after.map((row) => [row.status, row.receipt])).toEqual([
      ["delivered", "recorded"],
      ["delivered", "recorded"],
    ]);
    expect(after[0].nextAttemptAt).toBeUndefined();
    const queue = await queueOf(f);
    expect(queue?.pendingCount).toBe(0);
    expect(queue?.nextAttemptAt).toBeUndefined();
    expect(queue?.leaseUntil).toBeUndefined();
  });

  test("the delivery carries the contract's fields", async () => {
    const f = await formFixture();
    const [id] = await seedPending(f, 1);
    let seen: unknown;
    await runDeliveryPass(
      runner(f),
      f.instanceId,
      transportWith(async (_engine, delivery) => {
        seen = delivery;
        return "recorded";
      })
    );
    expect(seen).toMatchObject({
      submissionId: id,
      pageId: await pageIdOf(f),
      formId: FORM,
      viewer: null,
      fields: [{ id: "song", label: "Song", type: "text", value: "0" }],
    });
    expect(new Date((seen as { submittedAt: string }).submittedAt).toISOString()).toBe(
      (seen as { submittedAt: string }).submittedAt
    );
  });

  test("a duplicate receipt counts as delivered", async () => {
    const f = await formFixture();
    await seedPending(f, 1);
    await runDeliveryPass(
      runner(f),
      f.instanceId,
      transportWith(async () => "duplicate")
    );
    expect((await rows(f))[0]).toMatchObject({ status: "delivered", receipt: "duplicate" });
  });

  test("an offline engine leaves every row untouched and backs off once", async () => {
    const f = await formFixture();
    await seedPending(f, 3);
    const transport = transportWith(RECORDED, async () => {
      throw new TypeError("fetch failed");
    });
    const before = Date.now();
    await runDeliveryPass(runner(f), f.instanceId, transport);
    expect(transport.sent).toEqual([]);
    const after = await rows(f);
    expect(after.every((row) => row.status === "pending" && row.attempts === 0)).toBe(true);
    const queue = await queueOf(f);
    expect(queue).toMatchObject({ pendingCount: 3, consecutiveFailures: 1, engineProblem: "unreachable" });
    expect(queue?.nextAttemptAt ?? 0).toBeGreaterThanOrEqual(before + SUBMISSION_DELIVERY.backoffBaseMs / 2);

    // Not due yet, so another pass does not contact the engine.
    const probes = { count: 0 };
    await runDeliveryPass(
      runner(f),
      f.instanceId,
      transportWith(RECORDED, async () => {
        probes.count += 1;
        return true;
      })
    );
    expect(probes.count).toBe(0);
  });

  test("an engine without the capability leaves rows pending, then a new one gets them", async () => {
    const f = await formFixture();
    await seedPending(f, 1);
    await runDeliveryPass(
      runner(f),
      f.instanceId,
      transportWith(RECORDED, async () => false)
    );
    expect((await rows(f))[0].status).toBe("pending");
    expect((await queueOf(f))?.engineProblem).toBe("capability_missing");

    await f.t.run(async (ctx) => {
      const queue = await ctx.db.query("pageSubmissionQueues").first();
      if (queue) {
        await ctx.db.patch(queue._id, { nextAttemptAt: 1, engineRetryAt: 1 });
      }
    });
    await runDeliveryPass(runner(f), f.instanceId, transportWith(RECORDED));
    expect((await rows(f))[0].status).toBe("delivered");
    const queue = await queueOf(f);
    expect(queue?.consecutiveFailures).toBe(0);
    expect(queue?.engineProblem).toBeUndefined();
  });

  test("an unregistered engine stays pending", async () => {
    const f = await formFixture();
    await seedPending(f, 1);
    await f.t.run((ctx) => ctx.db.patch(f.instanceId, { clientId: undefined, clientSecret: undefined }));
    await runDeliveryPass(runner(f), f.instanceId, transportWith(RECORDED));
    expect((await rows(f))[0].status).toBe("pending");
    expect((await queueOf(f))?.engineProblem).toBe("not_registered");
  });

  test("a malformed submission fails with its reason while the others deliver", async () => {
    const f = await formFixture();
    const ids = await seedPending(f, 3);
    await runDeliveryPass(
      runner(f),
      f.instanceId,
      transportWith(async (_engine, delivery) => {
        if (delivery.submissionId === ids[1]) {
          throw new Error("UserPageSubmissionRefused: fields.0.value is too long");
        }
        return "recorded";
      })
    );
    const after = await rows(f);
    expect(after.map((row) => row.status)).toEqual(["delivered", "failed", "delivered"]);
    expect(after[1].failureReason).toBe("fields.0.value is too long");
    expect((await queueOf(f))?.pendingCount).toBe(0);
  });

  test("an unknown error backs off only that row, so it can't hold up the others", async () => {
    const f = await formFixture();
    const ids = await seedPending(f, 2);
    await runDeliveryPass(
      runner(f),
      f.instanceId,
      transportWith(async (_engine, delivery) => {
        if (delivery.submissionId === ids[0]) {
          throw new Error("something odd");
        }
        return "recorded";
      })
    );
    const after = await rows(f);
    expect(after[0]).toMatchObject({ status: "pending", attempts: 1, lastError: "something odd" });
    expect(after[0].nextAttemptAt ?? 0).toBeGreaterThan(Date.now());
    expect(after[1].status).toBe("delivered");
    const queue = await queueOf(f);
    expect(queue?.pendingCount).toBe(1);
    expect(queue?.consecutiveFailures).toBe(0);
    expect(queue?.nextAttemptAt).toBe(after[0].nextAttemptAt);
  });

  test("a timeout stops the pass and backs off the engine", async () => {
    const f = await formFixture();
    await seedPending(f, 3);
    const transport = transportWith(async () => {
      throw new EngineTimeoutError(1);
    });
    await runDeliveryPass(runner(f), f.instanceId, transport);
    expect(transport.sent).toHaveLength(1);
    expect((await queueOf(f))?.engineProblem).toBe("unreachable");
    expect((await rows(f)).every((row) => row.status === "pending")).toBe(true);
  });

  test("an unreadable receipt is not taken as delivered", async () => {
    const f = await formFixture();
    await seedPending(f, 1);
    await runDeliveryPass(
      runner(f),
      f.instanceId,
      transportWith(async () => {
        throw new Error("Engine answered with an unreadable receipt");
      })
    );
    expect((await rows(f))[0].status).toBe("pending");
  });

  test("a held lease refuses a second pass, and a dead one runs out", async () => {
    const f = await formFixture();
    await seedPending(f, 1);
    expect(await f.t.mutation(internal.userPageForms.claimDeliveryPass, { instanceId: f.instanceId })).not.toBeNull();
    expect(await f.t.mutation(internal.userPageForms.claimDeliveryPass, { instanceId: f.instanceId })).toBeNull();
    await f.t.run(async (ctx) => {
      const queue = await ctx.db.query("pageSubmissionQueues").first();
      if (queue) {
        await ctx.db.patch(queue._id, { leaseUntil: 1 });
      }
    });
    expect(await f.t.mutation(internal.userPageForms.claimDeliveryPass, { instanceId: f.instanceId })).not.toBeNull();
  });

  test("a full batch leaves the rest for a follow-up pass", async () => {
    const f = await formFixture();
    await seedPending(f, SUBMISSION_DELIVERY.batchSize + 1);
    const transport = transportWith(RECORDED);
    await runDeliveryPass(runner(f), f.instanceId, transport);
    expect(transport.sent).toHaveLength(SUBMISSION_DELIVERY.batchSize);
    const scheduled = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((job) => job.name.includes("deliverInstance"))).toBe(true);
  });

  test("the sweep wakes due queues only", async () => {
    const f = await formFixture();
    await seedPending(f, 1);
    await f.t.mutation(internal.userPageForms.sweepDueQueues, {});
    const count = async () =>
      (await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) =>
        job.name.includes("deliverInstance")
      ).length;
    expect(await count()).toBe(1);
    await f.t.run(async (ctx) => {
      const queue = await ctx.db.query("pageSubmissionQueues").first();
      if (queue) {
        await ctx.db.patch(queue._id, { nextAttemptAt: Date.now() + 60_000 });
      }
    });
    await f.t.mutation(internal.userPageForms.sweepDueQueues, {});
    expect(await count()).toBe(1);
  });

  test("delivered rows are pruned after retention; pending and failed ones stay", async () => {
    const f = await formFixture();
    const [oldId, recentId, failedId, pendingId] = await seedPending(f, 4);
    await f.t.run(async (ctx) => {
      const old = Date.now() - SUBMISSION_DELIVERY.deliveredRetentionMs - 1;
      await ctx.db.patch(oldId, { status: "delivered", deliveredAt: old, nextAttemptAt: undefined });
      await ctx.db.patch(recentId, { status: "delivered", deliveredAt: Date.now(), nextAttemptAt: undefined });
      await ctx.db.patch(failedId, { status: "failed", failureReason: "bad", nextAttemptAt: undefined });
    });
    await f.t.mutation(internal.userPageForms.pruneDelivered, {});
    expect((await rows(f)).map((row) => row._id)).toEqual([recentId, failedId, pendingId]);
  });
});

describe("the cap", () => {
  async function fillQueue(f: Fixture, pendingCount: number) {
    const pageId = await pageIdOf(f);
    await f.t.run((ctx) =>
      ctx.db.insert("pageSubmissionQueues", {
        instanceId: f.instanceId,
        pageId,
        pendingCount,
        consecutiveFailures: 0,
      })
    );
  }

  test("at the cap a submit is refused", async () => {
    const f = await formFixture();
    await fillQueue(f, USER_PAGE_LIMITS.pendingSubmissionsPerPage);
    expect(await refusal(await post(f, submitBody({ turnstileToken: "t" })))).toEqual({
      status: 503,
      code: "not_accepting",
    });
    expect(await rows(f)).toHaveLength(0);
  });

  test("reaching the cap closes the form, and a delivery reopens it", async () => {
    const f = await formFixture();
    await fillQueue(f, USER_PAGE_LIMITS.pendingSubmissionsPerPage - 1);
    expect(formAccepting(await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy" }))).toBe(true);
    expect((await post(f, submitBody({ turnstileToken: "t" }))).status).toBe(200);
    expect(formAccepting(await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy" }))).toBe(false);

    const [row] = await rows(f);
    await f.t.mutation(internal.userPageForms.recordDeliveryOutcome, {
      submissionId: row._id,
      outcome: { kind: "delivered", receipt: "recorded" },
    });
    expect(formAccepting(await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy" }))).toBe(true);
  });
});

describe("the dashboard", () => {
  test("a member sees submissions; a stranger sees none", async () => {
    const f = await formFixture();
    await seedPending(f, 2);
    const args = { instanceId: f.instanceId, formId: FORM, paginationOpts: { numItems: 10, cursor: null } };
    const seen = await f.member.query(api.userPageForms.listSubmissions, args);
    expect(seen.page).toHaveLength(2);
    expect((await f.member.query(api.userPageForms.listSubmissions, { ...args, formId: "other" })).page).toEqual([]);
    expect(seen.page[0].fields[0].value).toBe("1");
    expect((await f.stranger.query(api.userPageForms.listSubmissions, args)).page).toEqual([]);
    expect(await f.stranger.query(api.userPageForms.queueStatus, { instanceId: f.instanceId })).toBeNull();
  });

  test("retrying a failed row sends it again, past the engine's backoff", async () => {
    const f = await formFixture();
    const [id] = await seedPending(f, 1);
    await f.t.mutation(internal.userPageForms.recordDeliveryOutcome, {
      submissionId: id,
      outcome: { kind: "rejected", reason: "bad" },
    });
    await f.t.run(async (ctx) => {
      const queue = await ctx.db.query("pageSubmissionQueues").first();
      if (queue) {
        await ctx.db.patch(queue._id, { engineRetryAt: Date.now() + 60_000, nextAttemptAt: undefined });
      }
    });
    await expect(f.stranger.mutation(api.userPageForms.retrySubmission, { submissionId: id })).rejects.toThrow();

    await f.member.mutation(api.userPageForms.retrySubmission, { submissionId: id });
    expect((await rows(f))[0]).toMatchObject({ status: "pending" });
    expect((await rows(f))[0].failureReason).toBeUndefined();
    expect((await queueOf(f))?.pendingCount).toBe(1);

    await runDeliveryPass(runner(f), f.instanceId, transportWith(RECORDED));
    expect((await rows(f))[0].status).toBe("delivered");
  });

  test("retrying a row that isn't failed changes nothing", async () => {
    const f = await formFixture();
    const [id] = await seedPending(f, 1);
    await f.member.mutation(api.userPageForms.retrySubmission, { submissionId: id });
    expect((await queueOf(f))?.pendingCount).toBe(1);
  });

  test("deleting the instance removes its submissions and queue", async () => {
    const f = await formFixture();
    await seedPending(f, 2);
    await f.t.mutation(internal.instances.deleteInstanceData, { instanceId: f.instanceId });
    await f.t.mutation(internal.userPageForms.deleteInstanceSubmissions, { instanceId: f.instanceId });
    expect(await queueOf(f)).toBeNull();
    expect(await rows(f)).toHaveLength(0);
  });
});

describe("classifying a failed delivery", () => {
  test.each([
    ["a refusal", new Error("UserPageSubmissionRefused: bad"), { kind: "rejected", reason: "bad" }],
    [
      "a timeout",
      new EngineTimeoutError(5),
      { kind: "retry", scope: "engine", reason: "engine did not answer within 5ms" },
    ],
    ["a failed fetch", new TypeError("fetch failed"), { kind: "retry", scope: "engine", reason: "fetch failed" }],
    [
      "a bad gateway",
      new Error("RPC request failed: 502 Bad Gateway"),
      { kind: "retry", scope: "engine", reason: "RPC request failed: 502 Bad Gateway" },
    ],
    ["anything else", new Error("db down"), { kind: "retry", scope: "submission", reason: "db down" }],
    ["a thrown string", "odd", { kind: "retry", scope: "submission", reason: "odd" }],
  ])("%s", (_name, error, expected) => {
    expect(classifyDeliveryError(error)).toEqual(expected as ReturnType<typeof classifyDeliveryError>);
  });
});

describe("backoffDelayMs", () => {
  const { backoffBaseMs, backoffMaxMs } = SUBMISSION_DELIVERY;

  test("doubles per failure, with jitter of up to half", () => {
    expect(backoffDelayMs(1, 0)).toBe(backoffBaseMs / 2);
    expect(backoffDelayMs(1, 0.999)).toBeLessThan(backoffBaseMs);
    expect(backoffDelayMs(2, 0)).toBe(backoffBaseMs);
  });

  test("stays at the cap", () => {
    expect(backoffDelayMs(50, 0)).toBe(backoffMaxMs / 2);
    expect(backoffDelayMs(5000, 0.999)).toBeLessThan(backoffMaxMs);
  });
});
