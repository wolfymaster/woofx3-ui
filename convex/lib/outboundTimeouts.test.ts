import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const CONVEX_DIR = new URL("..", import.meta.url).pathname;

/** Where each `fetch(` call in `source` starts, with the call's text up to its closing parenthesis. */
function fetchCalls(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(/(?<![.\w])fetch\(/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < source.length) {
      depth += (source[end] === "(" ? 1 : 0) - (source[end] === ")" ? 1 : 0);
      end++;
    }
    calls.push(source.slice(match.index, end));
  }
  return calls;
}

describe("outbound fetches", () => {
  test("every fetch in convex/ carries an abort signal", () => {
    const missing: string[] = [];
    for (const path of readdirSync(CONVEX_DIR, { recursive: true, encoding: "utf8" })) {
      const isSource = path.endsWith(".ts") && !path.endsWith(".d.ts") && !path.includes(".test.");
      if (!isSource || path.startsWith("_generated") || path.includes(".fakes.") || path.includes(".testing.")) {
        continue;
      }
      for (const call of fetchCalls(readFileSync(`${CONVEX_DIR}/${path}`, "utf8"))) {
        if (!call.includes("signal")) {
          missing.push(`${path}: ${call.split("\n")[0]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("finds a fetch with no signal", () => {
    expect(fetchCalls(`await fetch(url, { method: "GET" });`)).toHaveLength(1);
    expect(fetchCalls(`await t.fetch(url)`)).toHaveLength(0);
  });
});
