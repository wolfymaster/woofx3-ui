import { readdirSync } from "node:fs";
import { convexTest } from "convex-test";
import rateLimiterSchema from "../../node_modules/@convex-dev/rate-limiter/src/component/schema";
import schema from "../schema";

const CONVEX_DIR = new URL("..", import.meta.url).pathname;

/**
 * Every Convex module, keyed as `import.meta.glob` would key them for
 * convex-test. Bun has no `import.meta.glob`, so the tree is listed by hand.
 */
function convexModules(): Record<string, () => Promise<unknown>> {
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const path of readdirSync(CONVEX_DIR, { recursive: true, encoding: "utf8" })) {
    const isModule = /\.(ts|js)$/.test(path) && !path.endsWith(".d.ts") && !path.includes(".test.");
    if (isModule) {
      modules[`./${path}`] = () => import(`${CONVEX_DIR}${path}`);
    }
  }
  return modules;
}

const RATE_LIMITER_DIR = new URL("../../node_modules/@convex-dev/rate-limiter/src/component/", import.meta.url)
  .pathname;

/** The rate limiter component's modules, listed by hand for the same reason, as its own test helper needs a glob. */
function rateLimiterModules(): Record<string, () => Promise<unknown>> {
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const path of readdirSync(RATE_LIMITER_DIR, { recursive: true, encoding: "utf8" })) {
    if (/\.ts$/.test(path) && !path.includes(".test.")) {
      modules[`./component/${path}`] = () => import(`${RATE_LIMITER_DIR}${path}`);
    }
  }
  return modules;
}

/** An in-memory Convex backend with this app's schema and functions, for tests that need real queries and mutations. */
export function newBackend() {
  const t = convexTest(schema, convexModules());
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules());
  return t;
}
