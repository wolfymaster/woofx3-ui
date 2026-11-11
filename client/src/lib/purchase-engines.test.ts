import { describe, expect, test } from "bun:test";
import {
  engineToSelectForReturn,
  forgetPurchaseEngine,
  PURCHASE_ENGINES_KEPT,
  type PurchaseEngineStorage,
  purchaseEngineOf,
  rememberPurchaseEngine,
} from "./purchase-engines";

function memoryStorage(
  initial: Record<string, string> = {}
): PurchaseEngineStorage & { items: Record<string, string> } {
  const items = { ...initial };
  return {
    items,
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value;
    },
  };
}

const throwing: PurchaseEngineStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("full");
  },
};

describe("purchase engines", () => {
  test("a checkout's engine is remembered, read back and forgotten", () => {
    const storage = memoryStorage();
    rememberPurchaseEngine(storage, "c1", "engine-a", 1);
    rememberPurchaseEngine(storage, "c2", "engine-b", 2);
    expect(purchaseEngineOf(storage, "c1")).toBe("engine-a");
    forgetPurchaseEngine(storage, "c1");
    expect(purchaseEngineOf(storage, "c1")).toBeNull();
    expect(purchaseEngineOf(storage, "c2")).toBe("engine-b");
  });

  test("only the newest checkouts are kept", () => {
    const storage = memoryStorage();
    for (let at = 0; at <= PURCHASE_ENGINES_KEPT; at += 1) {
      rememberPurchaseEngine(storage, `c${at}`, "engine", at);
    }
    expect(purchaseEngineOf(storage, "c0")).toBeNull();
    expect(purchaseEngineOf(storage, `c${PURCHASE_ENGINES_KEPT}`)).toBe("engine");
  });

  test.each([
    ["no storage", null],
    ["storage that throws", throwing],
    ["storage holding something that is not JSON", memoryStorage({ "woofx3.purchaseEngines": "{nope" })],
    ["storage holding an array", memoryStorage({ "woofx3.purchaseEngines": "[1]" })],
  ])("%s remembers nothing and never throws", (_name, storage) => {
    expect(() => rememberPurchaseEngine(storage, "c1", "engine-a", 1)).not.toThrow();
    expect(() => forgetPurchaseEngine(storage, "c1")).not.toThrow();
    if (storage === throwing || storage === null) {
      expect(purchaseEngineOf(storage, "c1")).toBeNull();
    }
  });

  test("an id naming an object member is not an entry", () => {
    expect(purchaseEngineOf(memoryStorage(), "constructor")).toBeNull();
  });
});

describe("engineToSelectForReturn", () => {
  test.each([
    ["the remembered engine when another is selected", "engine-a", "engine-b", ["engine-a", "engine-b"], "engine-a"],
    ["nothing when it is already selected", "engine-a", "engine-a", ["engine-a"], null],
    ["nothing when nothing is remembered", null, "engine-b", ["engine-a", "engine-b"], null],
    ["nothing when the caller is no longer on it", "engine-a", "engine-b", ["engine-b"], null],
  ])("selects %s", (_name, remembered, selected, memberOf, expected) => {
    expect(engineToSelectForReturn(remembered, selected, memberOf)).toBe(expected);
  });
});
