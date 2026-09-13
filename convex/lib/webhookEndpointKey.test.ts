import { describe, expect, it } from "bun:test";
import { isWebhookTrigger, webhookEndpointKey } from "./webhookEndpointKey";

const KEY = {
  triggerKey: "example_store:trigger:orders",
  modulePrefix: "example_store",
  triggerManifestId: "orders",
};

describe("isWebhookTrigger", () => {
  it("recognizes a webhook trigger by transport or by its reserved event", () => {
    expect(isWebhookTrigger({ transport: "webhook" })).toBe(true);
    expect(isWebhookTrigger({ event: "webhook.example_store.orders" })).toBe(true);
  });

  it("does not match bus triggers", () => {
    expect(isWebhookTrigger({ transport: "eventbus", event: "store.order.created" })).toBe(false);
    expect(isWebhookTrigger({})).toBe(false);
  });
});

describe("webhookEndpointKey", () => {
  it("keys a webhook trigger by its projectionKey", () => {
    expect(webhookEndpointKey({ transport: "webhook", projectionKey: "example_store:trigger:orders" })).toEqual(KEY);
  });

  it("recognizes a webhook trigger by its reserved event when transport is absent", () => {
    expect(
      webhookEndpointKey({ event: "webhook.example_store.orders", projectionKey: "example_store:trigger:orders" })
    ).toEqual(KEY);
  });

  it("ignores bus triggers", () => {
    expect(
      webhookEndpointKey({
        transport: "eventbus",
        event: "store.order.created",
        projectionKey: "example_store:trigger:x",
      })
    ).toBeNull();
  });

  it("ignores a webhook trigger with no usable projectionKey", () => {
    expect(webhookEndpointKey({ transport: "webhook" })).toBeNull();
    expect(webhookEndpointKey({ transport: "webhook", projectionKey: "example_store:action:orders" })).toBeNull();
    expect(
      webhookEndpointKey({ transport: "webhook", projectionKey: "example_store:1.0.0:trigger:orders" })
    ).toBeNull();
  });
});
