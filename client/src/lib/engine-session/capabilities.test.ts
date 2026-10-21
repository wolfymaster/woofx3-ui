import { describe, expect, test } from "bun:test";
import type { EngineCapabilities } from "@woofx3/api";
import { readEngineCapabilities } from "./capabilities";

describe("readEngineCapabilities", () => {
  const cases: Array<{ name: string; report: unknown; expected: unknown }> = [
    {
      name: "known ids, sorted and unique, dropping ids this build does not know",
      report: { schema: 1, capabilities: ["events.log", "future.thing", "engine.eventStream", "events.log"] },
      expected: { ok: true, capabilities: ["engine.eventStream", "events.log"] },
    },
    {
      name: "a report of another schema is refused",
      report: { schema: 2, capabilities: [] },
      expected: { ok: false, error: "unreadable capability report (schema 2)" },
    },
    {
      name: "a report without a list is refused",
      report: { schema: 1 },
      expected: { ok: false, error: "unreadable capability report (schema 1)" },
    },
  ];

  for (const { name, report, expected } of cases) {
    test(name, () => {
      expect(readEngineCapabilities(report as EngineCapabilities)).toEqual(expected as never);
    });
  }
});
