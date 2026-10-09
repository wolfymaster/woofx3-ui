import { describe, expect, it } from "bun:test";
import {
  bareKind,
  type KindDeclarer,
  type ManifestResourceKind,
  parseKindRef,
  resolveResourceKind,
  resourceKindMatches,
} from "./resourceKinds";

function declares(moduleName: string, ...kinds: string[]): KindDeclarer {
  return {
    moduleName,
    kinds: kinds.map((kind): ManifestResourceKind => ({ kind, name: kind, description: "", schema: [] })),
  };
}

describe("parseKindRef", () => {
  it("reads a bare kind and a qualified one", () => {
    expect(parseKindRef("timer")).toEqual({ kind: "timer" });
    expect(parseKindRef("woofx3:timer")).toEqual({ module: "woofx3", kind: "timer" });
  });

  it("refuses anything else", () => {
    expect(parseKindRef("")).toBeNull();
    expect(parseKindRef(":timer")).toBeNull();
    expect(parseKindRef("woofx3:")).toBeNull();
    expect(parseKindRef("a:b:c")).toBeNull();
  });

  it("names a kind without its module", () => {
    expect(bareKind("woofx3:counter")).toBe("counter");
    expect(bareKind("counter")).toBe("counter");
  });
});

describe("resourceKindMatches", () => {
  it("matches a qualified field only to its own module's kind", () => {
    expect(resourceKindMatches("woofx3:timer", "woofx3:timer")).toBe(true);
    expect(resourceKindMatches("rival:timer", "woofx3:timer")).toBe(false);
  });

  it("matches a bare field, from a module installed before kinds were qualified, by name", () => {
    expect(resourceKindMatches("timer", "woofx3:timer")).toBe(true);
    expect(resourceKindMatches("counter", "woofx3:timer")).toBe(false);
  });

  it("matches nothing without a kind", () => {
    expect(resourceKindMatches(undefined, "woofx3:timer")).toBe(false);
  });
});

describe("resolveResourceKind", () => {
  const woofx3 = declares("woofx3", "counter", "timer");
  const wheels = declares("wheel_spin", "wheel");
  const rival = declares("rival", "wheel");

  it("finds a qualified kind in the module it names", () => {
    expect(resolveResourceKind([woofx3, wheels, rival], "rival:wheel")?.moduleName).toBe("rival");
    expect(resolveResourceKind([woofx3], "rival:wheel")).toBeNull();
  });

  it("finds a bare kind in the one module declaring it", () => {
    expect(resolveResourceKind([woofx3, wheels], "wheel")?.moduleName).toBe("wheel_spin");
  });

  it("cannot say which module a bare kind means when several declare it", () => {
    expect(resolveResourceKind([woofx3, wheels, rival], "wheel")).toBeNull();
  });

  it("finds nothing for a kind nobody declares", () => {
    expect(resolveResourceKind([woofx3], "wheel")).toBeNull();
  });
});
