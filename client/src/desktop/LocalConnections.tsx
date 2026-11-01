import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useEngineScope } from "@/engine/context";
import { actionErrorMessage } from "@/lib/action-error";
import { cn } from "@/lib/utils";
import {
  chooseDiscovered,
  confirmAddress,
  type EndpointView,
  hostMode,
  type IntegrationsView,
  type ModuleView,
  type RelayView,
  reconnectRelay,
  setEndpointEnabled,
  setSharePassword,
  type TestResult,
  testEndpoint,
} from "./host";
import { type ConnectionTone, connectionText, discoveryText, testText } from "./local-connections";
import { useIntegrationsFor } from "./use-integrations";

const TONE_DOT: Record<ConnectionTone, string> = {
  ok: "bg-green-500",
  pending: "bg-muted-foreground",
  problem: "bg-amber-500",
  off: "bg-muted-foreground/50",
};

/** Runs a host command for one endpoint, keeping its controls disabled while it is in flight. */
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
      setError(actionErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function AddressEditor({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: (address: string) => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState("");
  const address = input.trim();
  return (
    <div className="space-y-2">
      <Label htmlFor="local-connection-address">Address (host:port)</Label>
      <Input
        id="local-connection-address"
        value={input}
        placeholder="192.168.1.20:4455"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setInput(event.target.value)}
        data-testid="input-local-address"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy || address === ""} onClick={() => onConfirm(address)}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function EndpointControls({
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
  const { discovery } = endpoint;
  const discoveredAddress = discovery.kind === "found" ? `127.0.0.1:${discovery.port}` : null;
  const offerDiscovered = discoveredAddress !== null && endpoint.address?.display !== discoveredAddress;
  const canEnable = endpoint.bridgeable && endpoint.address !== null && relayAvailable;
  const connection = connectionText(endpoint, relay);
  const reconnectable = endpoint.enabled && (relay.kind === "displaced" || relay.kind === "refused");

  return (
    <section
      className="space-y-2 rounded-md border px-3 py-2 text-sm"
      data-testid={`local-connection-${module.moduleId}-${endpoint.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{endpoint.name}</span>
        <Switch
          checked={endpoint.enabled}
          disabled={busy || (!endpoint.enabled && !canEnable)}
          aria-label={`Connect ${endpoint.name}`}
          onCheckedChange={(enabled) => void run(() => setEndpointEnabled(...ids, enabled))}
          data-testid="switch-local-connection"
        />
      </div>

      {endpoint.bridgeable ? (
        <p className="text-xs text-muted-foreground">{discoveryText(endpoint)}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{endpoint.name} can't connect through the app yet.</p>
      )}

      {endpoint.address && (
        <p className="text-xs">
          Connects to <span className="font-mono">{endpoint.address.display}</span>{" "}
          <span className="text-muted-foreground">
            ({endpoint.address.origin === "discovered" ? "found on this computer" : "you entered it"})
          </span>
        </p>
      )}

      {editing ? (
        <AddressEditor
          busy={busy}
          onCancel={() => setEditing(false)}
          onConfirm={(address) => {
            void run(() => confirmAddress(...ids, address)).then((confirmed) => {
              if (confirmed) {
                setEditing(false);
              }
            });
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {offerDiscovered && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => chooseDiscovered(...ids))}
            >
              Use {discoveredAddress}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
            {endpoint.address ? "Use a different address" : "Enter an address"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || endpoint.address === null}
            onClick={() => {
              setTest(null);
              void run(async () => setTest(await testEndpoint(...ids)));
            }}
          >
            Test
          </Button>
          {reconnectable && (
            <Button size="sm" disabled={busy} onClick={() => void run(reconnectRelay)}>
              Reconnect
            </Button>
          )}
        </div>
      )}

      {endpoint.canSharePassword && (
        <div className="flex items-start gap-2">
          <Checkbox
            id={`share-${module.moduleId}-${endpoint.id}`}
            checked={endpoint.sharePassword}
            disabled={busy}
            onCheckedChange={(checked) => void run(() => setSharePassword(...ids, checked === true))}
          />
          <Label htmlFor={`share-${module.moduleId}-${endpoint.id}`} className="text-xs font-normal leading-snug">
            Send the {endpoint.name} password found on this computer to woofx3, so {module.moduleName} (
            {module.moduleId}) on your cloud engine can sign in. It's stored in your engine's settings for this module.
            You can type it there instead.
          </Label>
        </div>
      )}
      {endpoint.passwordSetByHand && (
        <p className="text-xs text-muted-foreground">
          The password was typed into the module's settings, so the app leaves it alone.
        </p>
      )}

      <p className="flex items-center gap-1.5 text-xs">
        <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[connection.tone])} aria-hidden />
        {connection.text}
      </p>
      {test && (
        <p className={cn("text-xs", test.kind === "ok" ? "text-muted-foreground" : "text-destructive")}>
          {testText(test)}
        </p>
      )}
      {endpoint.reportError && (
        <p className="text-xs text-destructive">Couldn't fill in the module's settings: {endpoint.reportError}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

function ModuleControls({ module, view }: { module: ModuleView; view: IntegrationsView }) {
  return module.endpoints.map((endpoint) => (
    <EndpointControls
      key={endpoint.id}
      module={module}
      endpoint={endpoint}
      relay={view.relay}
      relayAvailable={view.relayAvailable}
    />
  ));
}

/**
 * A module's local endpoints on its settings page. `elsewhere` shows when this
 * computer can't change them: it isn't the instance's linked computer, or the
 * module isn't among what the host serves.
 */
export function ModuleLocalConnections({
  instanceId,
  moduleId,
  elsewhere,
}: {
  instanceId: string;
  moduleId: string;
  elsewhere: ReactNode;
}) {
  const view = useIntegrationsFor(instanceId);
  const module = view?.modules.find((candidate) => candidate.moduleId === moduleId);
  if (!view || !module) {
    return elsewhere;
  }
  return (
    <div className="max-w-xl space-y-2" data-testid="local-endpoint-panel">
      <ModuleControls module={module} view={view} />
    </div>
  );
}

/** Every local endpoint across the instance's modules, on the Integrations page. */
export function ThisComputerConnections() {
  const { instanceId } = useEngineScope();
  const view = useIntegrationsFor(instanceId ?? undefined);
  const [hosted, setHosted] = useState(false);

  useEffect(() => {
    let disposed = false;
    hostMode().then(
      ({ mode }) => {
        if (!disposed) {
          setHosted(mode === "companion");
        }
      },
      (err: unknown) => {
        console.error("Couldn't read the app's mode from the host", err);
      }
    );
    return () => {
      disposed = true;
    };
  }, []);

  // A local engine dials these itself, so there is nothing to set up.
  if (!hosted) {
    return null;
  }
  return (
    <Card className="mt-6" id="local-connections" data-testid="this-computer-connections">
      <CardHeader>
        <CardTitle>On this computer</CardTitle>
        <CardDescription>
          Apps on this computer or your network that your engine reaches through woofx3.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ThisComputerBody view={view} />
      </CardContent>
    </Card>
  );
}

function ThisComputerBody({ view }: { view: IntegrationsView | null }) {
  if (!view) {
    return <p className="text-sm text-muted-foreground">This computer isn't linked to this instance.</p>;
  }
  switch (view.availability.kind) {
    case "off":
    case "loading":
      return <p className="text-sm text-muted-foreground">Loading…</p>;
    case "unavailable":
      return <p className="text-sm text-muted-foreground">Local connections need a newer woofx3.</p>;
    case "failed":
      return <p className="text-sm text-destructive">{view.availability.message}</p>;
    case "ready":
      break;
  }
  if (view.modules.length === 0) {
    return <p className="text-sm text-muted-foreground">None of your modules connect to anything on this computer.</p>;
  }
  return (
    <>
      {!view.relayAvailable && (
        <p className="text-sm text-muted-foreground">Your woofx3 doesn't offer the relay yet.</p>
      )}
      {view.modules.map((module) => (
        <div key={module.moduleId} className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{module.moduleName}</h3>
          <ModuleControls module={module} view={view} />
        </div>
      ))}
    </>
  );
}
