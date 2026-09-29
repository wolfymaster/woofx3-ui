import { describe, expect, test } from "bun:test";
import { createWriteFence } from "./write-fence";

describe("createWriteFence", () => {
  test("a read with no write since is current", () => {
    const fence = createWriteFence();
    const current = fence.read();
    expect(current()).toBe(true);
  });

  test("a read that started before a write is stale", () => {
    const fence = createWriteFence();
    const current = fence.read();
    fence.write();
    expect(current()).toBe(false);
  });

  test("a read that started after a write is current", () => {
    const fence = createWriteFence();
    fence.write();
    const current = fence.read();
    expect(current()).toBe(true);
  });
});
