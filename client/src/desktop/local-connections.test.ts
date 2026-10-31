import { describe, expect, test } from "bun:test";
import type { EndpointView, IntegrationsView } from "./host";
import { connectionText, discoveryText, endpointsToSetUp } from "./local-connections";

function endpoint(overrides: Partial<EndpointView> = {}): EndpointView {
  return {
    id: "ws",
    name: "Lights",
    bridgeable: true,
    discoverer: null,
    discovery: { kind: "manual" },
    address: null,
    enabled: false,
    sharePassword: false,
    canSharePassword: false,
    passwordSetByHand: false,
    reportError: null,
    ...overrides,
  };
}

function view(endpoints: EndpointView[], overrides: Partial<IntegrationsView> = {}): IntegrationsView {
  return {
    availability: { kind: "ready" },
    relayAvailable: true,
    relay: { kind: "notNeeded" },
    modules: [{ moduleId: "lights", moduleName: "Lights", endpoints }],
    ...overrides,
  };
}

const NONE: ReadonlySet<string> = new Set();
const ADDRESS = { display: "192.168.1.20:80", origin: "confirmed" as const };

describe("endpointsToSetUp", () => {
  test("an endpoint nobody has set up asks for attention, whichever module declares it", () => {
    expect(endpointsToSetUp(view([endpoint()]), NONE)).toEqual([{ key: "lights/ws", name: "Lights" }]);
  });

  test.each<[string, EndpointView]>([
    ["already on", endpoint({ enabled: true, address: ADDRESS })],
    ["turned off on purpose", endpoint({ address: ADDRESS })],
    ["unable to go through the relay", endpoint({ bridgeable: false })],
  ])("%s asks for nothing", (_name, candidate) => {
    expect(endpointsToSetUp(view([candidate]), NONE)).toEqual([]);
  });

  test("dismissing one leaves the others", () => {
    const endpoints = [endpoint(), endpoint({ id: "other", name: "Other" })];
    expect(endpointsToSetUp(view(endpoints), new Set(["lights/ws"]))).toEqual([{ key: "lights/other", name: "Other" }]);
  });

  test.each<[string, Partial<IntegrationsView>]>([
    ["integrations are still loading", { availability: { kind: "loading" } }],
    ["this woofx3 offers no relay", { relayAvailable: false }],
  ])("asks for nothing while %s", (_name, overrides) => {
    expect(endpointsToSetUp(view([endpoint()], overrides), NONE)).toEqual([]);
  });
});

describe("connectionText", () => {
  test("an endpoint that is off is off, whatever the relay is doing", () => {
    expect(connectionText(endpoint(), { kind: "connected" }).tone).toBe("off");
  });

  test("a connected relay says only the relay is connected, not that the app answered", () => {
    expect(connectionText(endpoint({ enabled: true }), { kind: "connected" })).toEqual({
      text: "Relay connected",
      tone: "ok",
    });
  });

  test("a displaced relay is a problem", () => {
    expect(connectionText(endpoint({ enabled: true }), { kind: "displaced" }).tone).toBe("problem");
  });
});

describe("discoveryText", () => {
  test("adds the discoverer's own hint when its server is switched off", () => {
    const off = endpoint({ name: "OBS", discoverer: "obs-websocket", discovery: { kind: "serverOff", port: 4455 } });
    expect(discoveryText(off)).toContain("Tools → WebSocket Server Settings");
  });

  test("names no particular app for an endpoint without a discoverer", () => {
    expect(discoveryText(endpoint({ discovery: { kind: "serverOff", port: 80 } }))).toBe("Lights is switched off.");
  });
});
