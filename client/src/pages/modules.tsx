import { installedListing } from "@convex/lib/marketplaceInstallIdentity";
import { Loader2, Store, Upload, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { PageIntro } from "@/components/common/page-intro";
import { type ModuleDetailMeta, ModuleDetailPanel } from "@/components/modules/module-detail-panel";
import { ModuleOAuthResultBanner } from "@/components/modules/module-oauth-result";
import { ApproveModulePermissionsDialog, type PermissionApprovalMode } from "@/components/modules/module-permissions";
import { ModuleSidebar } from "@/components/modules/module-sidebar";
import { ModuleStorageOverLimitAlert } from "@/components/modules/module-storage-usage";
import { UninstallModuleDialog } from "@/components/modules/uninstall-module-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEngineScope } from "@/engine/context";
import { useModuleStorageUsage } from "@/engine/hooks/use-module-storage-usage";
import { useInstalledModules, useModuleDetailRequest } from "@/engine/hooks/use-modules";
import type { InstalledModule, ModuleDetail, ModuleId } from "@/engine/types";
import { useModuleInstall } from "@/hooks/use-module-install";
import { useMarketplaceMode } from "@/lib/marketplace-mode";
import {
  installedModulePath,
  MARKETPLACE_INSTALLED_PATH,
  MARKETPLACE_PATH,
  MARKETPLACE_UPLOAD_PATH,
} from "@/lib/marketplace-route";
import { bareModuleKey } from "@/lib/module-key";

type SelectedModule =
  | { source: "installed"; module: InstalledModule }
  | { source: "marketplace"; marketplaceId: string };

export default function Modules() {
  const { instanceId: engineInstanceId } = useEngineScope();
  const [location, navigate] = useLocation();
  // `/marketplace/installed/:moduleId`: the module's id is an installed module's
  // bare key, or a marketplace id for one not installed yet.
  const segments = location.split("/").filter(Boolean);
  const routeModuleId =
    segments[0] === "marketplace" && segments[1] === "installed" && segments.length >= 3
      ? decodeURIComponent(segments[2])
      : undefined;

  const mode = useMarketplaceMode();
  const [oauthResult, dismissOauthResult] = mode.useOAuthReturn();

  const [selectedModule, setSelectedModule] = useState<SelectedModule | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledModule | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const getModuleDetail = useModuleDetailRequest();
  const [moduleDetail, setModuleDetail] = useState<ModuleDetail | null>(null);
  const [moduleDetailLoading, setModuleDetailLoading] = useState(false);
  const [moduleDetailError, setModuleDetailError] = useState<string | null>(null);
  // getModuleDetail is an action — a one-shot fetch, not a reactive query — so an install or update
  // that lands on the route we are already on would leave the panel rendering the superseded version
  // (and its "Update available" notice). Bumped when a module event reports success, to refetch.
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  // The install flow itself lives in useModuleInstall, shared with the
  // marketplace storefront: the approval gate, the engine's progress events
  // and the timeout have to stay together to be correct, and two copies of
  // that would drift.
  const install = useModuleInstall(() => setDetailRefreshKey((key) => key + 1));
  const { usage: moduleStorage } = useModuleStorageUsage();

  const prevSelectedRef = useRef(selectedModule);
  useEffect(() => {
    if (prevSelectedRef.current !== selectedModule) {
      install.dismissError();
      setShowErrorDetails(false);
      prevSelectedRef.current = selectedModule;
    }
  }, [selectedModule, install]);

  const installedModules = useInstalledModules();

  const handleSelectInstalled = useCallback(
    (moduleId: ModuleId) => {
      const target = (installedModules || []).find((m) => m.id === moduleId);
      navigate(installedModulePath(bareModuleKey(target?.moduleKey) ?? moduleId));
    },
    [navigate, installedModules]
  );

  useEffect(() => {
    if (routeModuleId === undefined) {
      setSelectedModule(null);
      return;
    }
    if (!installedModules) {
      return;
    }

    const byId = installedModules.find((m) => m.id === routeModuleId);
    if (byId) {
      setSelectedModule({ source: "installed", module: byId });
      return;
    }

    const byKey = installedModules.find((m) => m.moduleKey?.startsWith(routeModuleId + ":"));
    if (byKey) {
      setSelectedModule({ source: "marketplace", marketplaceId: routeModuleId });
      return;
    }

    setSelectedModule({ source: "marketplace", marketplaceId: routeModuleId });
  }, [routeModuleId, installedModules]);

  // An update started from the Installed list can be sitting on a route by module id (a
  // module with no moduleKey is addressed by its id), so land on the marketplace-id route the upgraded
  // module now answers to. Only ever re-routes a detail view onto itself: a route that already
  // matches would just churn the detail fetch below, and someone who has browsed back to the store
  // in the meantime should not be yanked out of it.
  useEffect(() => {
    if (!install.succeeded || !install.pendingModuleKey || routeModuleId === undefined) {
      return;
    }
    const marketplaceId = bareModuleKey(install.pendingModuleKey);
    if (marketplaceId && marketplaceId !== routeModuleId) {
      navigate(installedModulePath(marketplaceId));
    }
  }, [install.succeeded, install.pendingModuleKey, routeModuleId, navigate]);

  // A stable primitive (not the selectedModule object itself, which gets a new reference on every
  // reactive installedModules update even when the logical selection hasn't changed) — keeps the fetch
  // below from re-running the slow detail request on every unrelated change to the installed list.
  const detailModuleId = useMemo(
    () =>
      selectedModule
        ? selectedModule.source === "marketplace"
          ? selectedModule.marketplaceId
          : selectedModule.module.id
        : null,
    [selectedModule]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: detailRefreshKey re-triggers the fetch, it is not a value read in the body
  useEffect(() => {
    if (!detailModuleId || !engineInstanceId) {
      setModuleDetail(null);
      return;
    }
    setModuleDetailLoading(true);
    setModuleDetail(null);
    setModuleDetailError(null);
    let cancelled = false;
    void getModuleDetail(detailModuleId)
      .then((detail) => {
        if (!cancelled) {
          setModuleDetail(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setModuleDetailError(err instanceof Error ? err.message : "Failed to load module details.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setModuleDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detailModuleId, detailRefreshKey, engineInstanceId, getModuleDetail]);

  // Installing and updating are the same marketplace operation, and both need only the listing id.
  // For an installed module that is the listing it was installed from, derived here from its row —
  // rather than read off a `source: "marketplace"` selection — which is what makes Update reachable
  // from the Installed list and not only from the Store. Modules are routed by manifest id, which
  // every edition shares, so the route alone would update a later edition from its first.
  const selectedMarketplaceId = useMemo(() => {
    if (!selectedModule) {
      return null;
    }
    if (selectedModule.source === "marketplace") {
      const { marketplaceId } = selectedModule;
      const installed = installedModules?.find((m) => m.moduleKey?.startsWith(`${marketplaceId}:`));
      return (installed && installedListing(installed)?.listingId) ?? marketplaceId;
    }
    const { module } = selectedModule;
    const row = installedModules?.find((m) => m.id === module.id) ?? module;
    return installedListing(row)?.listingId ?? null;
  }, [selectedModule, installedModules]);

  const requestMarketplaceInstall = useCallback(
    (mode: PermissionApprovalMode) => {
      if (!moduleDetail || !selectedMarketplaceId) {
        return;
      }
      install.request({
        marketplaceId: selectedMarketplaceId,
        mode,
        moduleName: moduleDetail.name,
        permissionSets: {
          permissions: moduleDetail.permissions,
          latestPermissions: moduleDetail.latestPermissions,
          localEndpoints: moduleDetail.localEndpoints,
          latestLocalEndpoints: moduleDetail.latestLocalEndpoints,
        },
      });
    },
    [moduleDetail, selectedMarketplaceId, install]
  );

  const installedModuleForMarketplace = useMemo(() => {
    if (selectedModule?.source !== "marketplace" || !installedModules) {
      return null;
    }
    const mpId = selectedModule.marketplaceId;
    return installedModules.find((m) => m.moduleKey?.startsWith(mpId + ":")) ?? null;
  }, [selectedModule, installedModules]);

  const handleDelete = (module: InstalledModule) => {
    setUninstallTarget(module);
  };

  const handleUninstallSuccess = () => {
    setUninstallTarget(null);
    navigate(MARKETPLACE_INSTALLED_PATH);
  };

  const detailProps = useMemo(() => {
    if (!moduleDetail) {
      return null;
    }
    const meta: ModuleDetailMeta = {
      name: moduleDetail.name,
      description: moduleDetail.description,
      version: moduleDetail.version,
      latestVersion: moduleDetail.latestVersion,
      author: moduleDetail.author,
      category: moduleDetail.category,
      tags: moduleDetail.tags,
      isInstalled: moduleDetail.isInstalled,
      iconUrl: moduleDetail.iconUrl,
      readme: moduleDetail.readme,
      identifier: moduleDetail.id,
    };
    return {
      meta,
      triggers: moduleDetail.triggers,
      actions: moduleDetail.actions,
      functions: moduleDetail.functions,
      widgets: moduleDetail.widgets,
      workflows: moduleDetail.workflows,
      moduleDbId: moduleDetail.moduleDbId,
      manifestSettings: moduleDetail.manifestSettings,
      manifestResourceKinds: moduleDetail.manifestResourceKinds,
      permissions: moduleDetail.permissions,
      latestPermissions: moduleDetail.latestPermissions,
      localEndpoints: moduleDetail.localEndpoints,
      latestLocalEndpoints: moduleDetail.latestLocalEndpoints,
    };
  }, [moduleDetail]);

  // Installed-module metadata is already loaded locally (it's the same data the sidebar renders),
  // so the panel header can show immediately on click instead of waiting on getModuleDetail — avoids
  // a flash back to the storefront grid while the richer detail (triggers/readme/etc.) is still loading.
  const fallbackMeta: ModuleDetailMeta | null = useMemo(() => {
    if (selectedModule?.source !== "installed") {
      return null;
    }
    const m = selectedModule.module;
    return {
      name: m.name,
      description: m.description,
      version: m.version,
      author: m.author ?? "",
      category: m.category ?? "Utilities",
      tags: m.tags,
      isInstalled: m.status === "installed",
      identifier: bareModuleKey(m.moduleKey),
    };
  }, [selectedModule]);

  const meta = detailProps?.meta ?? fallbackMeta;

  // A module that ships with the engine cannot be uninstalled, so it offers no Remove.
  const shownModule = selectedModule?.source === "installed" ? selectedModule.module : installedModuleForMarketplace;
  const removableModule = shownModule && shownModule.provenance !== "builtIn" ? shownModule : null;

  return (
    <div className="flex h-full overflow-hidden max-w-[1600px] w-full">
      <ModuleSidebar
        selectedId={selectedModule?.source === "installed" ? selectedModule.module.id : null}
        onSelectModule={handleSelectInstalled}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {moduleStorage && <ModuleStorageOverLimitAlert usage={moduleStorage} className="mx-6 mt-4 w-auto" />}
        {selectedModule ? (
          <>
            {moduleDetailError ? (
              <div className="p-6 overflow-auto">
                <Card className="max-w-xl">
                  <CardContent className="pt-6 space-y-3">
                    <div className="flex items-center gap-2 text-destructive">
                      <XCircle className="h-4 w-4" />
                      <span className="font-medium">Failed to load module</span>
                    </div>
                    <p className="text-sm text-muted-foreground break-words">{moduleDetailError}</p>
                    <Button variant="outline" size="sm" onClick={() => navigate(MARKETPLACE_INSTALLED_PATH)}>
                      Back
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : meta ? (
              <div className="flex-1 min-h-0 flex flex-col">
                {oauthResult && (
                  <ModuleOAuthResultBanner result={oauthResult} onDismiss={dismissOauthResult} className="mx-6 mt-4" />
                )}
                <div className="flex-1 min-h-0">
                  <ModuleDetailPanel
                    module={meta}
                    triggers={detailProps?.triggers}
                    actions={detailProps?.actions}
                    functions={detailProps?.functions}
                    widgets={detailProps?.widgets}
                    workflows={detailProps?.workflows}
                    loading={moduleDetailLoading || !detailProps}
                    onBack={() => navigate(MARKETPLACE_INSTALLED_PATH)}
                    moduleDbId={detailProps?.moduleDbId}
                    manifestSettings={detailProps?.manifestSettings}
                    manifestResourceKinds={detailProps?.manifestResourceKinds}
                    permissions={detailProps?.permissions}
                    latestPermissions={detailProps?.latestPermissions}
                    localEndpoints={detailProps?.localEndpoints}
                    latestLocalEndpoints={detailProps?.latestLocalEndpoints}
                    onRemove={removableModule ? () => handleDelete(removableModule) : undefined}
                    onInstall={selectedMarketplaceId ? () => requestMarketplaceInstall("install") : undefined}
                    onUpdate={selectedMarketplaceId ? () => requestMarketplaceInstall("update") : undefined}
                    isInstalling={install.isInstalling}
                    installDisabled={meta.isInstalled}
                    installDisabledReason={meta.isInstalled ? "Already installed" : undefined}
                    installProgressMessage={install.progressMessage}
                    installSucceeded={install.succeeded}
                    installError={install.error}
                    onDismissError={() => {
                      install.dismissError();
                      setShowErrorDetails(false);
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 overflow-auto p-6 space-y-4">
            <PageIntro introId="modules" onTry={() => navigate(MARKETPLACE_PATH)} />
            <Card className="max-w-xl">
              <CardContent className="pt-6 space-y-3">
                <p className="font-medium">Your modules</p>
                <p className="text-sm text-muted-foreground">
                  Pick a module on the left to see what it adds and change its settings, or add one: from the
                  marketplace, or a module you made yourself.
                </p>
                <div className="flex flex-wrap gap-2">
                  {mode.uploads && (
                    <Button size="sm" onClick={() => navigate(MARKETPLACE_UPLOAD_PATH)}>
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Upload a module
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => navigate(MARKETPLACE_PATH)}>
                    <Store className="h-3.5 w-3.5 mr-1.5" />
                    Browse the marketplace
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={showErrorDetails} onOpenChange={setShowErrorDetails}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install Failed</DialogTitle>
          </DialogHeader>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm">{install.error}</pre>
        </DialogContent>
      </Dialog>

      <ApproveModulePermissionsDialog {...install.approvalDialogProps} />

      {engineInstanceId && (
        <UninstallModuleDialog
          open={uninstallTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setUninstallTarget(null);
            }
          }}
          module={uninstallTarget}
          onSuccess={handleUninstallSuccess}
        />
      )}
    </div>
  );
}
