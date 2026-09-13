import { describe, expect, it } from "bun:test";
import { DELIVERY_WRITE_INTERVAL_MS, shouldRecordDelivery } from "./inboundWebhookDelivery";

const NOW = 1_000_000;

describe("shouldRecordDelivery", () => {
  it("records the first delivery", () => {
    expect(shouldRecordDelivery({}, 200, undefined, NOW)).toBe(true);
  });

  it("skips an unchanged outcome inside the interval", () => {
    const previous = { lastDeliveryAt: NOW - DELIVERY_WRITE_INTERVAL_MS + 1, lastStatus: 200 };
    expect(shouldRecordDelivery(previous, 200, undefined, NOW)).toBe(false);
  });

  it("records an unchanged outcome once the interval has passed", () => {
    const previous = { lastDeliveryAt: NOW - DELIVERY_WRITE_INTERVAL_MS, lastStatus: 200 };
    expect(shouldRecordDelivery(previous, 200, undefined, NOW)).toBe(true);
  });

  it("always records a changed status or error", () => {
    const previous = { lastDeliveryAt: NOW - 1, lastStatus: 200 };
    expect(shouldRecordDelivery(previous, 401, undefined, NOW)).toBe(true);
    expect(shouldRecordDelivery(previous, 200, "engine unreachable", NOW)).toBe(true);
  });
});
