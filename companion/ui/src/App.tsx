import { useEffect, useState } from "react";
import { Integrations, useIntegrations } from "./Integrations";
import { type CompanionState, commands, currentState, onStateChange, type WindowState } from "./state";

type Tab = "status" | "engine" | "configuration" | "integrations";

/** Engine and Configuration are placeholders so later panels add content, not layout. */
const TABS: { id: Tab; label: string; enabled: boolean }[] = [
  { id: "status", label: "Status", enabled: true },
  { id: "engine", label: "Engine", enabled: false },
  { id: "configuration", label: "Configuration", enabled: false },
  { id: "integrations", label: "Integrations", enabled: true },
];

function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({ kind: "starting", update: null });
  useEffect(() => {
    let disposed = false;
    let eventSeen = false;
    let unlisten: (() => void) | null = null;
    // Subscribe before reading, so a change between the two is not lost. An
    // event that arrives first is newer than the reply, so the reply is then
    // ignored.
    onStateChange((next) => {
      eventSeen = true;
      setState(next);
    }).then((stop) => {
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    currentState().then((initial) => {
      if (!disposed && !eventSeen) {
        setState(initial);
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return state;
}

/** Runs a Rust command, keeping a button disabled while it is in flight. */
function useCommand() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(command: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await command();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <span>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

function Unpaired() {
  const { busy, error, run } = useCommand();
  return (
    <section className="panel centered">
      <h1>woofx3</h1>
      <p>Pair this computer with your woofx3 account</p>
      <button type="button" className="primary" disabled={busy} onClick={() => run(commands.startPairing)}>
        Pair
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Pairing({ state }: { state: Extract<CompanionState, { kind: "pairing" }> }) {
  const { busy, error, run } = useCommand();
  return (
    <section className="panel centered">
      <p className="code">{state.userCode}</p>
      <p>Approve this code in your browser</p>
      <p className="muted">
        Expires in <Countdown until={state.expiresAt} />
      </p>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => run(commands.openVerificationUrl)}>
          Open browser again
        </button>
        <button type="button" disabled={busy} onClick={() => run(commands.cancelPairing)}>
          Cancel
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function ConfirmPairing({ state }: { state: Extract<CompanionState, { kind: "confirmPairing" }> }) {
  const { busy, error, run } = useCommand();
  return (
    <section className="panel centered">
      <h2>Confirm pairing</h2>
      <p>
        Approved for <strong>{state.instanceName}</strong> by <strong>{state.approvedBy}</strong>
      </p>
      <p className="muted">
        Reject this if you do not recognise the instance or the person. Anyone who saw your code could have approved it.
      </p>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => run(commands.rejectPairing)}>
          Reject
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => run(commands.confirmPairing)}>
          Confirm
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function StatusPanel({ state }: { state: Extract<CompanionState, { kind: "paired" }> }) {
  const [confirmingUnpair, setConfirmingUnpair] = useState(false);
  const { busy, error, run } = useCommand();
  return (
    <section className="panel">
      <p>
        Paired with <strong>{state.instanceName}</strong>
      </p>
      <p className="status-line">
        <span className={state.cloudConnected ? "dot ok" : "dot off"} aria-hidden="true" />
        {state.cloudConnected ? "Connected to woofx3" : "Offline, reconnecting"}
      </p>
      {confirmingUnpair ? (
        <div className="confirm">
          <p>Unpair this computer? You will need to pair it again from the browser.</p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => setConfirmingUnpair(false)}>
              Keep paired
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => run(commands.unpair)}>
              Unpair
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmingUnpair(true)}>
          Unpair
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Paired({ state }: { state: Extract<CompanionState, { kind: "paired" }> }) {
  const [tab, setTab] = useState<Tab>("status");
  const integrations = useIntegrations();
  return (
    <>
      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === tab ? "tab active" : "tab"}
            disabled={!t.enabled}
            title={t.enabled ? undefined : "Coming soon"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "integrations" ? (
        <section className="panel">
          <Integrations instanceName={state.instanceName} view={integrations} />
        </section>
      ) : (
        <StatusPanel state={state} />
      )}
    </>
  );
}

function ErrorView({ message }: { message: string }) {
  const { busy, error, run } = useCommand();
  return (
    <section className="panel centered">
      <p className="error">{message}</p>
      <button type="button" className="primary" disabled={busy} onClick={() => run(commands.startPairing)}>
        Try again
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** Offered, never forced: the companion restarts only when this is clicked. */
function UpdateBanner({ version }: { version: string }) {
  const { busy, error, run } = useCommand();
  return (
    <aside className="update-banner">
      <div className="update-row">
        <p>woofx3 companion {version} is ready</p>
        <button type="button" className="primary" disabled={busy} onClick={() => run(commands.installUpdate)}>
          Restart to update
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </aside>
  );
}

function Screen({ state }: { state: CompanionState }) {
  switch (state.kind) {
    case "starting":
      return <section className="panel centered muted">Starting…</section>;
    case "offline":
      return <section className="panel centered muted">Offline — waiting to reach woofx3</section>;
    case "unpaired":
      return <Unpaired />;
    case "pairing":
      return <Pairing state={state} />;
    case "confirmPairing":
      return <ConfirmPairing state={state} />;
    case "paired":
      return <Paired state={state} />;
    case "error":
      return <ErrorView message={state.message} />;
  }
}

export function App() {
  const view = useWindowState();
  return (
    <>
      {view.update && <UpdateBanner version={view.update.version} />}
      <Screen state={view} />
    </>
  );
}
