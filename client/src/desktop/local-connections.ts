import type { DiscoveryView, EndpointView, IntegrationsView, RelayView, TestResult } from "./host";

/**
 * Hints that only make sense for one built-in discoverer, keyed by its id
 * (`EndpointView.discoverer`, from the host's own discoverer table).
 */
const DISCOVERER_HINTS: Record<string, { serverOff: string }> = {
  "obs-websocket": { serverOff: "Turn it on under Tools → WebSocket Server Settings." },
};

export function discoveryText(endpoint: EndpointView): string {
  const discovery: DiscoveryView = endpoint.discovery;
  switch (discovery.kind) {
    case "found":
      return `${endpoint.name} found on this computer, port ${discovery.port}`;
    case "serverOff": {
      const hint = endpoint.discoverer ? DISCOVERER_HINTS[endpoint.discoverer]?.serverOff : undefined;
      return hint ? `${endpoint.name} is switched off. ${hint}` : `${endpoint.name} is switched off.`;
    }
    case "notFound":
      return `${endpoint.name} wasn't found on this computer.`;
    case "searching":
      return "Looking on this computer…";
    case "unreadable":
      return `Couldn't read ${endpoint.name}'s settings on this computer.`;
    case "manual":
    case "unsupported":
    case "notPermitted":
      return "Enter its address to connect.";
  }
}

export type ConnectionTone = "ok" | "pending" | "problem" | "off";

/** How the endpoint is reached right now, from the relay's state. */
export function connectionText(endpoint: EndpointView, relay: RelayView): { text: string; tone: ConnectionTone } {
  if (!endpoint.enabled) {
    return { text: "Off", tone: "off" };
  }
  switch (relay.kind) {
    case "connected":
      return { text: "Relay connected", tone: "ok" };
    case "connecting":
      return { text: "Connecting…", tone: "pending" };
    case "retrying":
      return { text: `Offline: ${relay.error}`, tone: "problem" };
    case "displaced":
      return { text: "Offline: another connection took over", tone: "problem" };
    case "refused":
      return { text: "Offline: woofx3 refused the relay connection", tone: "problem" };
    case "unavailable":
      return { text: "Offline: your woofx3 doesn't offer the relay yet", tone: "problem" };
    case "notNeeded":
      return { text: "Offline", tone: "problem" };
  }
}

export function testText(result: TestResult): string {
  switch (result.kind) {
    case "ok":
      return result.protocol ? `Answered (${result.protocol})` : "Answered";
    case "refused":
      return `No: ${result.reason}`;
    case "timedOut":
      return "No answer within 3 seconds";
  }
}

export interface EndpointToSetUp {
  /** Stable across runs, so dismissing it lasts. */
  key: string;
  name: string;
}

/**
 * Endpoints nobody has set up: installed, able to go through the relay, off,
 * and without an address. One with an address was either turned off on purpose
 * or will be turned on by discovery, so it asks for nothing.
 */
export function endpointsToSetUp(view: IntegrationsView, dismissed: ReadonlySet<string>): EndpointToSetUp[] {
  if (view.availability.kind !== "ready" || !view.relayAvailable) {
    return [];
  }
  return view.modules.flatMap((module) =>
    module.endpoints
      .filter((endpoint) => endpoint.bridgeable && !endpoint.enabled && endpoint.address === null)
      .map((endpoint) => ({ key: `${module.moduleId}/${endpoint.id}`, name: endpoint.name }))
      .filter(({ key }) => !dismissed.has(key))
  );
}
