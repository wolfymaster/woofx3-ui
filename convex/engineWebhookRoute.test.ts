import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { EngineEventType } from "@woofx3/api/webhooks";
import { newBackend } from "./lib/convexTest.testing";

const SECRET = "webhook-secret";
const MARKER = "private-chat-text-4f2a";

/** Everything the app logged during a test, flattened to text. */
let logged: string[] = [];
const spies: { mockRestore: () => void }[] = [];
beforeEach(() => {
  logged = [];
  for (const method of ["log", "warn", "error"] as const) {
    spies.push(
      spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args)))
    );
  }
});
afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

async function backendWithInstance() {
  const t = newBackend();
  await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
      webhookSecret: SECRET,
    });
  });
  return t;
}

function post(t: Awaited<ReturnType<typeof backendWithInstance>>, body: string, secret?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== undefined) {
    headers.Authorization = `Bearer ${secret}`;
  }
  return t.fetch("/api/webhooks/woofx3", { method: "POST", headers, body });
}

describe("POST /api/webhooks/woofx3 before it trusts the caller", () => {
  test.each([
    ["a body with no type", JSON.stringify({ note: MARKER })],
    ["a body that is not JSON", `not json ${MARKER}`],
  ])("%s, with no Authorization header, is a 401 that logs nothing of the body", async (_name, body) => {
    const t = await backendWithInstance();
    const response = await post(t, body);
    expect(response.status).toBe(401);
    expect(logged.join("\n")).not.toContain(MARKER);
  });

  test.each([
    ["not JSON", "{oops"],
    ["a JSON array", "[1]"],
    ["JSON null", "null"],
  ])("%s, from a caller with a header, is a 400", async (_name, body) => {
    const t = await backendWithInstance();
    expect((await post(t, body, SECRET)).status).toBe(400);
  });

  test("a body with no type is a 400 that logs its field names and not its values", async () => {
    const t = await backendWithInstance();
    const response = await post(t, JSON.stringify({ chatLine: MARKER }), SECRET);
    expect(response.status).toBe(400);
    expect(logged.join("\n")).toContain("chatLine");
    expect(logged.join("\n")).not.toContain(MARKER);
  });

  test("an applied event does not put its payload in the logs", async () => {
    const t = await backendWithInstance();
    const body = JSON.stringify({
      specversion: "1.0",
      id: "env-1",
      source: "engine",
      type: EngineEventType.SCENE_CREATED,
      time: "2026-11-04T10:00:00.000Z",
      data: {
        type: EngineEventType.SCENE_CREATED,
        scene: {
          id: "s1",
          name: MARKER,
          description: "",
          widgetsJson: "[]",
          layoutJson: "{}",
          createdByType: "USER",
          createdByRef: "user",
          createdAt: "2026-11-04T10:00:00.000Z",
          updatedAt: "2026-11-04T10:00:00.000Z",
        },
      },
    });
    expect((await post(t, body, SECRET)).status).toBe(200);
    expect(logged.join("\n")).not.toContain(MARKER);
  });
});
