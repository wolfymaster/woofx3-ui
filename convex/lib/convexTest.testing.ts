import { readdirSync } from "node:fs";
import { convexTest } from "convex-test";
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

/** An in-memory Convex backend with this app's schema and functions, for tests that need real queries and mutations. */
export function newBackend() {
  return convexTest(schema, convexModules());
}
