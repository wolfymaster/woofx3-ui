import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { newBackend, settleBackends } from "./lib/convexTest.testing";

// An instance's client id and secret are a service token for Convex alone: a
// member who held them could call a hosted engine directly. This seeds one
// instance with recognisable credentials and calls every public query that
// can be called with an instance or an account, as a member of both. No
// result may contain a credential, however it got there.

const CONVEX_DIR = new URL(".", import.meta.url).pathname;
const SECRETS = {
  clientId: "SENTINEL-engine-client-id",
  clientSecret: "SENTINEL-engine-client-secret",
  webhookSecret: "SENTINEL-engine-webhook-secret",
  eventsTokenHash: "SENTINEL-events-token-hash",
};

afterAll(settleBackends);

interface RegisteredFunction {
  isPublic?: boolean;
  isQuery?: boolean;
  exportArgs?: () => string;
}

interface ArgField {
  fieldType: { type: string; tableName?: string };
  optional: boolean;
}

function moduleFiles(): string[] {
  return readdirSync(CONVEX_DIR, { recursive: true, encoding: "utf8" }).filter(
    (path) =>
      /\.ts$/.test(path) &&
      !path.endsWith(".d.ts") &&
      !path.includes(".test.") &&
      !path.includes(".testing.") &&
      !path.startsWith("_generated") &&
      !path.includes("convex.config") &&
      path !== "schema.ts" &&
      path !== "crons.ts" &&
      path !== "http.ts" &&
      !path.startsWith("migrations") &&
      !path.startsWith("seeds")
  );
}

/** Every public query, as `file:name` with the table each of its required arguments names, when it needs nothing else. */
async function callablePublicQueries(): Promise<Array<{ ref: string; needs: Array<[string, string]> }>> {
  const found: Array<{ ref: string; needs: Array<[string, string]> }> = [];
  for (const path of moduleFiles()) {
    const exports = (await import(`${CONVEX_DIR}${path}`)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(exports)) {
      const fn = value as RegisteredFunction;
      if (typeof value !== "function" || !fn.isPublic || !fn.isQuery || !fn.exportArgs) {
        continue;
      }
      const args = JSON.parse(fn.exportArgs()) as { type: string; value?: Record<string, ArgField> };
      const needs: Array<[string, string]> = [];
      let callable = args.type === "object";
      for (const [field, spec] of Object.entries(args.value ?? {})) {
        if (spec.optional) {
          continue;
        }
        if (
          spec.fieldType.type === "id" &&
          (spec.fieldType.tableName === "instances" || spec.fieldType.tableName === "accounts")
        ) {
          needs.push([field, spec.fieldType.tableName]);
        } else {
          callable = false;
        }
      }
      if (callable) {
        found.push({ ref: `${path.replace(/\.ts$/, "")}:${name}`, needs });
      }
    }
  }
  return found;
}

async function seed(t: ReturnType<typeof newBackend>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Member" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId: userId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId, role: "owner", createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Engine",
      url: "https://e.example",
      hosting: "managed",
      createdAt: 1,
      ...SECRETS,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId, role: "owner" });
    return { userId, accountId, instanceId };
  });
}

describe("no public query returns an engine credential", () => {
  test("every public query that takes an instance or an account", async () => {
    const t = newBackend();
    const { userId, accountId, instanceId } = await seed(t);
    const member = t.withIdentity({ subject: `${userId}|session` });
    const ids: Record<string, Id<"instances"> | Id<"accounts">> = { instances: instanceId, accounts: accountId };

    const queries = await callablePublicQueries();
    expect(queries.length).toBeGreaterThan(50);

    const leaking: string[] = [];
    for (const { ref, needs } of queries) {
      const args = Object.fromEntries(needs.map(([field, table]) => [field, ids[table]]));
      let result: unknown;
      try {
        result = await member.query(makeFunctionReference<"query">(ref), args);
      } catch {
        // A query that refuses these arguments returns nothing to leak.
        continue;
      }
      const text = JSON.stringify(result ?? null);
      if (Object.values(SECRETS).some((secret) => text.includes(secret))) {
        leaking.push(ref);
      }
    }
    expect(leaking, "these public queries return an engine credential").toEqual([]);
  });
});
