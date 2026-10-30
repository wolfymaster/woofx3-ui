import { describe, expect, test } from "bun:test";
import type { EngineModuleSummary } from "@woofx3/api";
import { toKindDeclarers, toModuleResourceInstance } from "./module-resources";

const module = (moduleId: string, manifest: Record<string, unknown> | null): EngineModuleSummary => ({
  name: moduleId,
  version: "1.0.0",
  state: "active",
  createdByType: "USER",
  moduleId,
  moduleKey: `${moduleId}:1.0.0:abc`,
  manifest,
});

const counterKind = { kind: "counter", name: "Counter", description: "Counts", schema: [] };

describe("toModuleResourceInstance", () => {
  test("names the instance's module by its manifest id and keeps its settings", () => {
    expect(
      toModuleResourceInstance({
        id: "row-1",
        moduleId: "uuid-1",
        moduleName: "counter",
        kind: "counter",
        instanceId: "deaths",
        displayName: "Deaths",
        canonicalId: "counter:counter:deaths",
        moduleKey: "counter:1.0.0:abc",
        settings: { step: 1 },
      })
    ).toEqual({
      canonicalId: "counter:counter:deaths",
      engineInstanceId: "row-1",
      resourceInstanceId: "deaths",
      kind: "counter",
      moduleId: "counter",
      moduleName: "counter",
      displayName: "Deaths",
      settings: { step: 1 },
    });
  });
});

describe("toKindDeclarers", () => {
  test("reads each module's declared kinds, named as its manifest names it", () => {
    const declarers = toKindDeclarers([
      module("counter", { id: "counter", resources: [counterKind] }),
      module("plain", null),
    ]);
    expect(declarers.map((d) => [d.moduleName, d.kinds.map((kind) => kind.kind)])).toEqual([
      ["counter", ["counter"]],
      ["plain", []],
    ]);
  });

  test("a module listed twice declares its kinds once", () => {
    const manifest = { id: "counter", resources: [counterKind] };
    expect(toKindDeclarers([module("counter", manifest), module("counter", manifest)])).toHaveLength(1);
  });
});
