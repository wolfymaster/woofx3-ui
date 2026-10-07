import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, Download, Laptop, Unplug } from "lucide-react";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { companionDownloadUrl, type LocalEndpointSituation, localEndpointSituation } from "@/lib/local-endpoints";
import { cn } from "@/lib/utils";

type ModuleLocalEndpoints = NonNullable<FunctionReturnType<typeof api.companionIntegrations.forModule>>;
type EndpointView = ModuleLocalEndpoints["endpoints"][number];

/**
 * How the engine reaches each of a module's local endpoints, above its
 * settings: through the companion, waiting on the companion, or with no
 * companion at all. Generic over the module's `local[]` declaration, so it
 * names the endpoint, never a particular app. Renders nothing for a module
 * without local endpoints, or where the engine or this deployment cannot use
 * the companion's bridge.
 */
export function LocalEndpointPanel({ instanceId, moduleId }: { instanceId: Id<"instances">; moduleId: string }) {
  const view = useQuery(api.companionIntegrations.forModule, moduleId ? { instanceId, moduleId } : "skip");
  const capability = useEngineCapabilities(instanceId).support("modules.localEndpoints");
  const now = useMinuteClock();
  if (!view || view.endpoints.length === 0) {
    return null;
  }
  const rows = view.endpoints.map((endpoint) => ({
    endpoint,
    situation: localEndpointSituation({
      capability,
      bridgeAvailable: view.bridgeAvailable,
      companion: view.companion,
      state: endpoint.state,
      now,
    }),
  }));
  if (rows.every((row) => row.situation.kind === "unsupported")) {
    return null;
  }
  return (
    <div className="max-w-xl space-y-2" data-testid="local-endpoint-panel">
      {rows.map(({ endpoint, situation }) => (
        <LocalEndpointRow key={endpoint.id} endpoint={endpoint} situation={situation} />
      ))}
    </div>
  );
}

function LocalEndpointRow({ endpoint, situation }: { endpoint: EndpointView; situation: LocalEndpointSituation }) {
  if (situation.kind === "unsupported") {
    return null;
  }
  if (situation.kind === "viaCompanion") {
    return (
      <section
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
          situation.online ? "border-green-500/30 bg-green-500/5" : "border-amber-500/40 bg-amber-500/5"
        )}
      >
        <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <p>
            {situation.online
              ? `${endpoint.name}: connected through the companion on ${situation.deviceName}.`
              : `${endpoint.name}: your companion on ${situation.deviceName} is offline.`}
          </p>
          {situation.address && (
            <p className="text-xs text-muted-foreground">
              The companion dials <span className="font-mono">{situation.address}</span>.
            </p>
          )}
          {endpoint.state?.sharesPassword && endpoint.passwordSetting && (
            <p className="text-xs text-muted-foreground">Password shared by the companion.</p>
          )}
        </div>
      </section>
    );
  }
  if (situation.kind === "companionNothingFound") {
    const next = endpoint.hasDiscovery
      ? "then turn it on in the companion's Integrations tab."
      : "then enter its address in the companion's Integrations tab.";
    return (
      <section className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
        <Unplug className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>
          The companion on {situation.deviceName} isn't connecting to {endpoint.name}. Check that {endpoint.name} is
          running on that computer, {next}
        </p>
      </section>
    );
  }
  const downloadUrl = companionDownloadUrl();
  return (
    <section className="space-y-1.5 rounded-md border px-3 py-2 text-sm">
      <p>
        {endpoint.name} runs on your computer. Install the woofx3 companion to connect your engine to it.
        {downloadUrl && (
          <>
            {" "}
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <Download className="h-3.5 w-3.5" />
              Download the companion
            </a>
          </>
        )}
      </p>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        If your engine isn't on the computer running {endpoint.name}, it can't reach 127.0.0.1.
      </p>
    </section>
  );
}
