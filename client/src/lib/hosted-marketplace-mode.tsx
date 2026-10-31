import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useMemo } from "react";
import { LocalEndpointPanel } from "@/components/modules/local-endpoint-panel";
import { ModuleWebhookEndpoints } from "@/components/modules/module-webhook-endpoints";
import { useInstance } from "@/hooks/use-instance";
import { useModuleOAuthReturn } from "@/hooks/use-module-oauth-return";
import type { MarketplaceMode, ModuleSettingSources, SettingSource } from "@/lib/marketplace-mode";

// The hosted app's Marketplace tab: an account that buys listings and takes
// uploads, inbound webhooks relayed from this deployment's site, and local
// endpoints the companion reaches and fills in.

type ModuleLocalEndpoints = FunctionReturnType<typeof api.companionIntegrations.forModule>;

function settingSourcesFrom(view: ModuleLocalEndpoints | undefined): Map<string, SettingSource> {
  const sources = new Map<string, SettingSource>();
  if (!view) {
    return sources;
  }
  const recorded = new Map(view.provenance.map((row) => [row.key, row.source]));
  for (const endpoint of view.endpoints) {
    const companionEnabled = endpoint.state?.enabled ?? false;
    for (const key of [endpoint.hostSetting, endpoint.portSetting, endpoint.passwordSetting]) {
      if (key) {
        sources.set(key, { source: recorded.get(key) ?? null, companionEnabled });
      }
    }
  }
  return sources;
}

/**
 * The companion writes settings in the engine, which pushes nothing to the
 * dashboard, so its writes recorded in Convex stand in for a change notice.
 */
function useHostedSettingSources(moduleId: string): ModuleSettingSources {
  const { instance } = useInstance();
  const instanceId = instance?._id ?? null;
  const view = useQuery(
    api.companionIntegrations.forModule,
    instanceId && moduleId ? { instanceId, moduleId } : "skip"
  );
  const handBack = useMutation(api.moduleSettingProvenance.useCompanionValue);
  const sources = useMemo(() => settingSourcesFrom(view), [view]);
  const revision =
    view === undefined
      ? null
      : (view?.provenance ?? [])
          .filter((row) => row.source === "companion")
          .map((row) => `${row.key}@${row.updatedAt}`)
          .join(",");
  const returnToCompanion = useCallback(
    async (key: string) => {
      if (!instanceId) {
        throw new Error("No instance selected");
      }
      await handBack({ instanceId, moduleId, key });
    },
    [handBack, instanceId, moduleId]
  );
  return useMemo(() => ({ sources, revision, returnToCompanion }), [sources, revision, returnToCompanion]);
}

/** A module's webhook URLs, and how the engine reaches its local endpoints through the companion. */
function HostedModuleSettingsExtras({ moduleId }: { moduleId: string }) {
  const { instance } = useInstance();
  if (!instance || !moduleId) {
    return null;
  }
  return (
    <>
      <ModuleWebhookEndpoints instanceId={instance._id} modulePrefix={moduleId} />
      <LocalEndpointPanel instanceId={instance._id} moduleId={moduleId} />
    </>
  );
}

export const hostedMarketplaceMode: MarketplaceMode = {
  purchases: true,
  uploads: true,
  ModuleSettingsExtras: HostedModuleSettingsExtras,
  useSettingSources: useHostedSettingSources,
  useOAuthReturn: useModuleOAuthReturn,
};
