import { describe, expect, test } from "bun:test";
import { describeTargetIssues, engineTargetSchema } from "./target";

const valid = { url: "http://localhost:8080", clientId: "client-1", clientSecret: "0a".repeat(32) };

describe("engineTargetSchema", () => {
  const cases: Array<{ name: string; target: unknown; issues: string | null }> = [
    { name: "a complete target", target: valid, issues: null },
    { name: "a blank client id", target: { ...valid, clientId: "" }, issues: "clientId" },
    { name: "a malformed url", target: { ...valid, url: "not a url" }, issues: "url" },
    { name: "a short secret", target: { ...valid, clientSecret: "0a0a" }, issues: "clientSecret" },
    { name: "an uppercase secret", target: { ...valid, clientSecret: "0A".repeat(32) }, issues: "clientSecret" },
    { name: "no target at all", target: undefined, issues: "target" },
  ];

  for (const { name, target, issues } of cases) {
    test(name, () => {
      const parsed = engineTargetSchema.safeParse(target);
      const described = parsed.success ? null : describeTargetIssues(parsed.error);
      expect(described?.split(":")[0] ?? null).toBe(issues);
      expect(described ?? "").not.toContain("0a0a");
    });
  }
});
