import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { convexTest } from "convex-test";
import schema from "../schema";

const CONVEX_DIR = new URL("..", import.meta.url).pathname;

/**
 * The rate limiter component's built modules. The package exports only its
 * config from there, so the directory is found through it.
 */
const RATE_LIMITER_DIR = dirname(createRequire(import.meta.url).resolve("@convex-dev/rate-limiter/convex.config"));
const rateLimiterSchema: SchemaDefinition<GenericSchema, boolean> = (await import(`${RATE_LIMITER_DIR}/schema.js`))
  .default;

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

function rateLimiterModules(): Record<string, () => Promise<unknown>> {
  return modulesIn(RATE_LIMITER_DIR, (path) => path.endsWith(".js"));
}

/** An in-memory Convex backend with this app's schema, functions and components, for tests that need real queries and mutations. */
export function newBackend() {
  const t = convexTest(schema, convexModules());
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules());
  return t;
}
