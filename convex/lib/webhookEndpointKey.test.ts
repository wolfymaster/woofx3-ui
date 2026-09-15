import { describe, expect, it } from "bun:test";
import { isWebhookTrigger, webhookEndpointKey, webhookEndpointKeys } from "./webhookEndpointKey";

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

describe("webhookEndpointKeys", () => {
  it("keys every webhook trigger and skips bus triggers", () => {
    expect(
      webhookEndpointKeys([
        { transport: "webhook", projectionKey: "example_store:trigger:orders" },
        { transport: "eventbus", event: "store.order.created" },
      ])
    ).toEqual({ keys: [KEY], complete: true });
  });

  // An engine whose trigger listing leaves projectionKey off must not read as
  // one whose webhook triggers are all gone.
  it("is incomplete when a webhook trigger cannot be keyed", () => {
    expect(
      webhookEndpointKeys([
        { transport: "webhook", projectionKey: "example_store:trigger:orders" },
        { event: "webhook.example_store.refunds" },
      ])
    ).toEqual({ keys: [KEY], complete: false });
  });
});
