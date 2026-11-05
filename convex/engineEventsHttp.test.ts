import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { Id, TableNames } from "./_generated/dataModel";
import { ENGINE_EVENT_BATCH_PATH } from "./engineEventsHttp";
import { newBackend } from "./lib/convexTest.testing";

const SECRET = "whsec_engine_events_test";
const TOKEN_HASH = "a".repeat(64);
const NOW = "2026-11-04T10:00:00.000Z";

type Backend = ReturnType<typeof newBackend>;

let previousSecret: string | undefined;
beforeAll(() => {
  previousSecret = process.env.MAINTENANCE_WEBHOOK_SECRET;
  process.env.MAINTENANCE_WEBHOOK_SECRET = SECRET;
});
afterAll(() => {
  process.env.MAINTENANCE_WEBHOOK_SECRET = previousSecret;
});

/** The relay's side, kept independent of the implementation under test. */
function sign(body: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

async function backendWithInstance(): Promise<{ t: Backend; instanceId: Id<"instances"> }> {
  const t = newBackend();
  const instanceId = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    return ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
      eventsTokenHash: TOKEN_HASH,
    });
  });
  return { t, instanceId };
}

let seq = 0;
function queued(
  instanceId: string,
  data: Record<string, unknown>,
  overrides: { tokenHash?: string; id?: string } = {}
) {
  seq++;
  return {
    queueId: String(seq),
    instanceId,
    tokenHash: overrides.tokenHash ?? TOKEN_HASH,
    envelope: {
      specversion: "1.0",
      id: overrides.id ?? `env-${seq}`,
      source: "engine",
      type: data.type,
      time: NOW,
      data,
    },
  };
}

async function postBatch(t: Backend, events: unknown[], secret = SECRET) {
  const body = JSON.stringify({ batchId: "batch-1", events });
  return t.fetch(ENGINE_EVENT_BATCH_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Woofx3-Signature": sign(body, secret) },
    body,
  });
}

async function rows(t: Backend, table: TableNames) {
  return t.run((ctx) => ctx.db.query(table).collect());
}

const scene = (id: string, name: string) => ({
  id,
  name,
  description: "",
  widgetsJson: "[]",
  layoutJson: "{}",
  createdByType: "USER",
  createdByRef: "user",
  createdAt: NOW,
  updatedAt: NOW,
});

describe("POST /api/engine-events/batch", () => {
  test("a mixed batch answers one outcome per event", async () => {
    const { t, instanceId } = await backendWithInstance();
    const applied = queued(instanceId, { type: EngineEventType.SCENE_CREATED, scene: scene("s-1", "One") });
    const ignored = queued(instanceId, { type: "something.new" });
    const rejected = queued(instanceId, { type: EngineEventType.ALERT_RECORDED, alert: {} });
    const unknown = queued("k57abcdefghijklmnopqrstuvwxyz012", { type: "something.new" });
    const response = await postBatch(t, [applied, ignored, rejected, unknown]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        { queueId: applied.queueId, outcome: "applied" },
        { queueId: ignored.queueId, outcome: "ignored" },
        {
          queueId: rejected.queueId,
          outcome: "rejected",
          reason: "Alert callback needs an alert with an id and a status",
        },
        { queueId: unknown.queueId, outcome: "rejected", reason: "unknown_instance" },
      ],
    });
    expect((await rows(t, "scenes")).length).toBe(1);
  });

  test("an envelope already applied answers duplicate", async () => {
    const { t, instanceId } = await backendWithInstance();
    const event = queued(instanceId, { type: EngineEventType.SCENE_CREATED, scene: scene("s-1", "One") });
    await postBatch(t, [event]);
    const response = await postBatch(t, [{ ...event, queueId: "99" }]);
    expect(await response.json()).toEqual({ results: [{ queueId: "99", outcome: "duplicate" }] });
  });

  test("a token hash that no longer matches is rejected as stale", async () => {
    const { t, instanceId } = await backendWithInstance();
    const event = queued(
      instanceId,
      { type: EngineEventType.SCENE_CREATED, scene: scene("s-1", "One") },
      {
        tokenHash: "b".repeat(64),
      }
    );
    const response = await postBatch(t, [event]);
    expect(await response.json()).toEqual({
      results: [{ queueId: event.queueId, outcome: "rejected", reason: "stale_token" }],
    });
    expect((await rows(t, "scenes")).length).toBe(0);
  });

  test("an event that throws fails the whole batch and writes nothing", async () => {
    const { t, instanceId } = await backendWithInstance();
    const good = queued(instanceId, { type: EngineEventType.SCENE_CREATED, scene: scene("s-1", "One") });
    const poison = queued(instanceId, { type: EngineEventType.SCENE_CREATED, scene: { id: "s-2" } });
    const response = await postBatch(t, [good, poison]);
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("batch_failed");
    expect((await rows(t, "scenes")).length).toBe(0);
    expect((await rows(t, "engineEventReceipts")).length).toBe(0);
    expect((await rows(t, "engineEventLog")).length).toBe(0);
  });

  test("a bad signature answers 401", async () => {
    const { t, instanceId } = await backendWithInstance();
    const event = queued(instanceId, { type: "something.new" });
    const response = await postBatch(t, [event], "wrong-secret");
    expect(response.status).toBe(401);
  });

  test("a malformed batch answers 400", async () => {
    const { t } = await backendWithInstance();
    const response = await postBatch(t, [{ queueId: "x" }]);
    expect(response.status).toBe(400);
  });

  test("events of one instance apply in batch order", async () => {
    const { t, instanceId } = await backendWithInstance();
    const first = queued(instanceId, { type: EngineEventType.SCENE_CREATED, scene: scene("s-1", "First") });
    const second = queued(instanceId, { type: EngineEventType.SCENE_UPDATED, scene: scene("s-1", "Second") });
    await postBatch(t, [first, second]);
    const [stored] = await rows(t, "scenes");
    expect((stored as { name: string }).name).toBe("Second");
    const log = await rows(t, "engineEventLog");
    expect(log.map((row) => (row as { envelopeId?: string }).envelopeId)).toEqual([
      first.envelope.id,
      second.envelope.id,
    ]);
  });
});
