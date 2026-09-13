import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CONVEX_SITE_URL } from "@/lib/convexSiteUrl";

interface WebhookEndpointSummary {
  endpointId: string;
  triggerManifestId: string;
  lastDeliveryAt?: number;
  lastStatus?: number;
  lastError?: string;
}

interface ModuleWebhookEndpointsProps {
  instanceId: Id<"instances">;
  /** The module's manifest id. */
  modulePrefix: string;
}

/**
 * The public URLs a module's webhook triggers answer on, for the streamer to
 * give to the service that sends them. Renders nothing for a module without
 * any.
 */
export function ModuleWebhookEndpoints({ instanceId, modulePrefix }: ModuleWebhookEndpointsProps) {
  const endpoints = useQuery(api.inboundWebhooks.listForInstanceModule, { instanceId, modulePrefix });
  if (!endpoints || endpoints.length === 0) {
    return null;
  }
  return (
    <section className="space-y-3 max-w-xl">
      <div>
        <h3 className="text-sm font-medium">Webhook endpoints</h3>
        <p className="text-xs text-muted-foreground">Give each URL to the service that sends this module's webhooks.</p>
      </div>
      {endpoints.map((endpoint) => (
        <WebhookEndpointRow key={endpoint.endpointId} endpoint={endpoint} />
      ))}
    </section>
  );
}

function WebhookEndpointRow({ endpoint }: { endpoint: WebhookEndpointSummary }) {
  const url = `${CONVEX_SITE_URL}/api/webhooks/${endpoint.endpointId}`;
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-muted-foreground">{endpoint.triggerManifestId}</span>
        <span className="text-xs text-muted-foreground">{lastDeliveryLabel(endpoint)}</span>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded bg-muted px-2 py-1 text-xs">{url}</code>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => void copyUrl()} aria-label="Copy URL">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      {endpoint.lastError && <p className="text-xs text-destructive">{endpoint.lastError}</p>}
    </div>
  );
}

function lastDeliveryLabel(endpoint: WebhookEndpointSummary): string {
  if (endpoint.lastDeliveryAt === undefined) {
    return "Never delivered";
  }
  const when = formatDistanceToNow(endpoint.lastDeliveryAt, { addSuffix: true });
  return endpoint.lastStatus === undefined ? `Last delivery ${when}` : `Last delivery ${when} (${endpoint.lastStatus})`;
}
