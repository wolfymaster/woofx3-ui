import { useEffect, useState } from "react";
import {
  commands,
  currentIntegrations,
  type DiscoveryView,
  type EndpointView,
  type IntegrationsView,
  type ModuleView,
  onIntegrationsChange,
  type RelayView,
  type TestResult,
} from "./state";

const OFF: IntegrationsView = {
  availability: { kind: "off" },
  relayAvailable: false,
  relay: { kind: "notNeeded" },
  modules: [],
};

/** Follows the Rust process's integrations view, the same way `useWindowState` follows the pairing state. */
export function useIntegrations(): IntegrationsView {
  const [view, setView] = useState<IntegrationsView>(OFF);
  useEffect(() => {
    let disposed = false;
    let eventSeen = false;
    let unlisten: (() => void) | null = null;
    onIntegrationsChange((next) => {
      eventSeen = true;
      setView(next);
    }).then((stop) => {
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    currentIntegrations().then((initial) => {
      if (!disposed && !eventSeen) {
        setView(initial);
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return view;
}

/** Runs a command for one endpoint, keeping its controls disabled while it is in flight. */
function useEndpointCommand() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(command: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await command();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/**
 * Hints that only make sense for one built-in discoverer, keyed by its id
 * (`EndpointView.discoverer`, from the companion's own discoverer table).
 */
const DISCOVERER_HINTS: Record<string, { serverOff: string }> = {
  "obs-websocket": { serverOff: "Turn it on under Tools → WebSocket Server Settings." },
};

function discoveryText(endpoint: EndpointView): string {
  const discovery: DiscoveryView = endpoint.discovery;
  switch (discovery.kind) {
    case "found":
      return `${endpoint.name} found on this PC, port ${discovery.port}`;
    case "serverOff": {
      const hint = endpoint.discoverer ? DISCOVERER_HINTS[endpoint.discoverer]?.serverOff : undefined;
      return hint ? `${endpoint.name} is switched off. ${hint}` : `${endpoint.name} is switched off.`;
    }
    case "notFound":
      return "Not found";
    case "searching":
      return "Looking on this PC…";
    case "unreadable":
      return `Couldn't read ${endpoint.name}'s settings on this PC.`;
    case "manual":
      return "Enter its address below.";
    case "unsupported":
      return "This companion can't search for it yet. Enter its address below.";
    case "notPermitted":
      return "Discovery not available for this module. Enter its address below.";
  }
}

/** How the endpoint is reached right now, from the relay's state. */
function connectionText(endpoint: EndpointView, relay: RelayView): { text: string; ok: boolean } {
  if (!endpoint.enabled) {
    return { text: "Off", ok: false };
  }
  switch (relay.kind) {
    case "connected":
      return { text: "Connected", ok: true };
    case "connecting":
      return { text: "Connecting…", ok: false };
    case "retrying":
      return { text: `Offline: ${relay.error}`, ok: false };
    case "displaced":
      return { text: "Offline: another companion connection took over", ok: false };
    case "refused":
      return { text: "Offline: woofx3 refused the relay connection", ok: false };
    case "unavailable":
      return { text: "Offline: your woofx3 doesn't offer the companion relay yet", ok: false };
    case "notNeeded":
      return { text: "Offline", ok: false };
  }
}

function testText(result: TestResult): string {
  switch (result.kind) {
    case "ok":
      return result.protocol ? `Answered (${result.protocol})` : "Answered";
    case "refused":
      return `No: ${result.reason}`;
    case "timedOut":
      return "No answer within 3 seconds";
  }
}

function AddressEditor({
  onConfirm,
  onCancel,
  busy,
}: {
  onConfirm: (address: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [input, setInput] = useState("");
  const trimmed = input.trim();
  return (
    <div className="confirm">
      <label className="field">
        <span>Address (host:port)</span>
        <input
          type="text"
          value={input}
          placeholder="192.168.1.20:4455"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setInput(event.target.value)}
        />
      </label>
      <p className="muted">The companion connects only to an address you confirm here or one it found on this PC.</p>
      <div className="row">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy || trimmed === ""} onClick={() => onConfirm(trimmed)}>
          Confirm address
        </button>
      </div>
    </div>
  );
}

function Endpoint({
  module,
  endpoint,
  relay,
  relayAvailable,
}: {
  module: ModuleView;
  endpoint: EndpointView;
  relay: RelayView;
  relayAvailable: boolean;
}) {
  const { busy, error, run } = useEndpointCommand();
  const [editing, setEditing] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const ids = [module.moduleId, endpoint.id] as const;
  const discovery = endpoint.discovery;
  const discoveredAddress = discovery.kind === "found" ? `127.0.0.1:${discovery.port}` : null;
  const offerDiscovered = discoveredAddress !== null && endpoint.address?.display !== discoveredAddress;
  const canEnable = endpoint.bridgeable && endpoint.address !== null && relayAvailable;
  const connection = connectionText(endpoint, relay);

  return (
    <article className="endpoint">
      <div className="endpoint-head">
        <h3>{endpoint.name}</h3>
        <label className="switch" title={canEnable || endpoint.enabled ? undefined : "Choose an address first"}>
          <input
            type="checkbox"
            checked={endpoint.enabled}
            disabled={busy || (!endpoint.enabled && !canEnable)}
            onChange={(event) => {
              const enabled = event.target.checked;
              run(() => commands.setEndpointEnabled(...ids, enabled));
            }}
          />
          <span>{endpoint.enabled ? "On" : "Off"}</span>
        </label>
      </div>

      {!endpoint.bridgeable && <p className="muted">{endpoint.name} can't be connected through the companion yet.</p>}

      <p className="muted">{discoveryText(endpoint)}</p>

      {endpoint.address ? (
        <p>
          Connects to <span className="mono">{endpoint.address.display}</span>{" "}
          <span className="muted">
            ({endpoint.address.origin === "discovered" ? "found on this PC" : "you entered it"})
          </span>
        </p>
      ) : (
        <p className="muted">No address yet.</p>
      )}

      {editing ? (
        <AddressEditor
          busy={busy}
          onCancel={() => setEditing(false)}
          onConfirm={async (address) => {
            if (await run(() => commands.confirmAddress(...ids, address))) {
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="row">
          {offerDiscovered && (
            <button type="button" disabled={busy} onClick={() => run(() => commands.chooseDiscovered(...ids))}>
              Use {discoveredAddress}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setEditing(true)}>
            Use a different address
          </button>
        </div>
      )}

      {endpoint.canSharePassword && (
        <label className="check">
          <input
            type="checkbox"
            checked={endpoint.sharePassword}
            disabled={busy}
            onChange={(event) => {
              const share = event.target.checked;
              run(() => commands.setSharePassword(...ids, share));
            }}
          />
          <span>
            Send the {endpoint.name} password found on this PC to woofx3, so {module.moduleName} ({module.moduleId}) on
            your cloud engine can sign in
            <small className="muted">
              The password is stored in your engine's settings for this module. You can type it there instead.
            </small>
          </span>
        </label>
      )}
      {endpoint.passwordSetByHand && (
        <p className="muted">The password was typed into the module's settings, so the companion leaves it alone.</p>
      )}

      <div className="endpoint-foot">
        <p className="status-line">
          <span className={connection.ok ? "dot ok" : "dot off"} aria-hidden="true" />
          {connection.text}
        </p>
        <button
          type="button"
          disabled={busy || endpoint.address === null}
          onClick={async () => {
            setTest(null);
            await run(async () => setTest(await commands.testEndpoint(...ids)));
          }}
        >
          Test
        </button>
      </div>
      {test && <p className={test.kind === "ok" ? "muted" : "error"}>{testText(test)}</p>}
      {endpoint.reportError && <p className="error">Could not fill in the module's settings: {endpoint.reportError}</p>}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

/** One section per installed module that declares local endpoints, generated from their `local[]` entries. */
export function Integrations({ instanceName, view }: { instanceName: string; view: IntegrationsView }) {
  switch (view.availability.kind) {
    case "off":
    case "loading":
      return <p className="muted">Loading…</p>;
    case "unavailable":
      return <p className="muted">Integrations need a newer woofx3.</p>;
    case "failed":
      return <p className="error">{view.availability.message}</p>;
    case "ready":
      break;
  }
  if (view.modules.length === 0) {
    return <p className="muted">None of the modules on {instanceName} connect to anything on this PC.</p>;
  }
  return (
    <div className="integrations">
      {!view.relayAvailable && <p className="notice">Your woofx3 doesn't offer the companion relay yet.</p>}
      {view.modules.map((module) => (
        <section key={module.moduleId} className="module">
          <h2>{module.moduleName}</h2>
          {module.endpoints.map((endpoint) => (
            <Endpoint
              key={endpoint.id}
              module={module}
              endpoint={endpoint}
              relay={view.relay}
              relayAvailable={view.relayAvailable}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
