import { describe, expect, test } from "bun:test";
import type { InstanceRole } from "@convex/lib/instanceRoles";
import { canStartPayment } from "./marketplace-access";

describe("canStartPayment", () => {
  const cases: { role: InstanceRole | null | undefined; allowed: boolean }[] = [
    { role: "owner", allowed: true },
    { role: "admin", allowed: false },
    { role: "member", allowed: false },
    { role: null, allowed: false },
    { role: undefined, allowed: false },
  ];
  for (const { role, allowed } of cases) {
    test(`${String(role)} ${allowed ? "may" : "may not"} start a payment`, () => {
      expect(canStartPayment(role)).toBe(allowed);
    });
  }
});
