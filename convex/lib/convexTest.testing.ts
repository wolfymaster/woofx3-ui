import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { FunctionReference, GenericSchema, SchemaDefinition } from "convex/server";
import { convexTest } from "convex-test";
import schema from "../schema";

const CONVEX_DIR = new URL("..", import.meta.url).pathname;

/**
 * A component's built modules. Each package exports only its config from
 * there, so the directory is found through it.
 */
function componentDir(configSpecifier: string): string {
  return dirname(createRequire(import.meta.url).resolve(configSpecifier));
}

async function componentSchema(dir: string): Promise<SchemaDefinition<GenericSchema, boolean>> {
  return (await import(`${dir}/schema.js`)).default;
}

const RATE_LIMITER_DIR = componentDir("@convex-dev/rate-limiter/convex.config");
const MIGRATIONS_DIR = componentDir("@convex-dev/migrations/convex.config");
const rateLimiterSchema = await componentSchema(RATE_LIMITER_DIR);
const migrationsSchema = await componentSchema(MIGRATIONS_DIR);

/**
 * Every Convex module under `dir`, keyed as `import.meta.glob` would key them
 * for convex-test (`./` plus the path within `dir`). Bun has no
 * `import.meta.glob`, so the tree is listed by hand.
 */
function modulesIn(dir: string, isModule: (path: string) => boolean): Record<string, () => Promise<unknown>> {
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const path of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (isModule(path)) {
      modules[`./${path}`] = () => import(`${dir}/${path}`);
    }
  }
  return modules;
}

function convexModules(): Record<string, () => Promise<unknown>> {
  return modulesIn(
    CONVEX_DIR,
    (path) => /\.(ts|js)$/.test(path) && !path.endsWith(".d.ts") && !path.includes(".test.")
  );
}

function componentModules(dir: string): Record<string, () => Promise<unknown>> {
  return modulesIn(dir, (path) => path.endsWith(".js"));
}

/** An in-memory Convex backend with this app's schema, functions and components, for tests that need real queries and mutations. */
export function newBackend() {
  const t = convexTest(schema, convexModules());
  t.registerComponent("rateLimiter", rateLimiterSchema, componentModules(RATE_LIMITER_DIR));
  t.registerComponent("migrations", migrationsSchema, componentModules(MIGRATIONS_DIR));
  return t;
}

type MigrationRef = FunctionReference<
  "mutation",
  "internal",
  { cursor?: string | null; dryRun?: boolean; oneBatchOnly?: boolean; batchSize?: number }
>;

/**
 * Runs a `migrations.define` migration over its whole table in one batch,
 * the way the component runs each batch, without the component's scheduler.
 */
export async function runMigration(t: ReturnType<typeof newBackend>, migration: MigrationRef): Promise<void> {
  await t.mutation(migration, { cursor: null, dryRun: false, oneBatchOnly: true, batchSize: 10_000 });
}

/**
 * Lets a chain of scheduled functions, each scheduling the next, run until
 * the newest job has finished. Fails after `maxRounds` rounds so a chain that
 * never ends fails the test instead of hanging it.
 */
export async function finishScheduledChain(t: ReturnType<typeof newBackend>, maxRounds = 10_000): Promise<void> {
  for (let round = 0; round < maxRounds; round++) {
    await t.finishInProgressScheduledFunctions();
    const newest = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").order("desc").first());
    const waiting = newest !== null && (newest.state.kind === "pending" || newest.state.kind === "inProgress");
    if (!waiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`scheduled functions still waiting after ${maxRounds} rounds`);
}
