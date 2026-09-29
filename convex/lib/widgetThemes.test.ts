import { describe, expect, test } from "bun:test";
import { installedModulesRevision } from "./widgetThemes";

describe("installedModulesRevision", () => {
  test("ignores rows that are not installed and row order", () => {
    const a = installedModulesRevision([
      { status: "installed", moduleKey: "b:1.0.0:x" },
      { status: "pending", moduleKey: "c:1.0.0:y" },
      { status: "installed", moduleKey: "a:1.0.0:z" },
    ]);
    const b = installedModulesRevision([
      { status: "installed", moduleKey: "a:1.0.0:z" },
      { status: "installed", moduleKey: "b:1.0.0:x" },
    ]);
    expect(a).toBe(b);
  });

  test("changes on install, upgrade and removal", () => {
    const before = installedModulesRevision([{ status: "installed", moduleKey: "a:1.0.0:z" }]);
    expect(
      installedModulesRevision([
        { status: "installed", moduleKey: "a:1.0.0:z" },
        { status: "installed", moduleKey: "neon:1.0.0:q" },
      ])
    ).not.toBe(before);
    expect(installedModulesRevision([{ status: "installed", moduleKey: "a:1.1.0:w" }])).not.toBe(before);
    expect(installedModulesRevision([])).not.toBe(before);
  });
});
