import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { oauthErrorMessage } from "@convex/lib/oauthErrors";
import type { ModuleDetailResult } from "@convex/moduleDetail";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { Check, Loader2, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PageIntro } from "@/components/common/page-intro";
import { type ModuleDetailMeta, ModuleDetailPanel } from "@/components/modules/module-detail-panel";
import { ApproveModulePermissionsDialog, type PermissionApprovalMode } from "@/components/modules/module-permissions";
import { ModuleSidebar } from "@/components/modules/module-sidebar";
import { ModuleStore } from "@/components/modules/module-store";
import { UninstallModuleDialog } from "@/components/modules/uninstall-module-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstance } from "@/hooks/use-instance";
import { useMarketplaceCatalog } from "@/hooks/use-marketplace-catalog";
import { useModuleInstall } from "@/hooks/use-module-install";
import { bareModuleKey } from "@/lib/module-key";

interface ModuleListItem {
  _id: Id<"moduleRepository">;
  name: string;
  description: string;
  version: string;
  tags: string[];
  author: string;
  category: string;
  moduleKey?: string;
  isInstalled: boolean;
  status?: "pending" | "delivering" | "installed" | "failed";
}

/**
 * A connect of a module's `oauth[]` integration (moduleOAuth.ts) the OAuth
 * callback sent the browser back with. `label` names the provider to the
 * streamer.
 */
type OAuthResult =
  | { status: "finishing"; connectCode: string; label: string }
  | { status: "connected"; label: string }
  | { status: "error"; message: string };

/** The provider's name for messages: the integration id, capitalized. */
function integrationLabel(integration: string): string {
  return integration.charAt(0).toUpperCase() + integration.slice(1);
}

type SelectedModule =
  | { source: "installed"; module: ModuleListItem }
  | { source: "marketplace"; marketplaceId: string };

// Marketplace category of platform modules, such as Twitch and OBS.
const PLATFORM_CATEGORY = "platform";

export default function Modules() {
  const { instance } = useInstance();
  const [location, navigate] = useLocation();
  const segments = location.split("/").filter(Boolean);
  const routeModuleId =
    segments[0] === "modules" && segments.length >= 2 && segments[1] !== "install" && segments[1] !== "installed"
      ? segments[1]
      : undefined;

  const searchString = useSearch();
  const selectedCategory = new URLSearchParams(searchString).get("category") || "all";
  const handleSelectCategory = useCallback(
    (category: string) => {
      navigate(category === "all" ? "/modules" : `/modules?category=${encodeURIComponent(category)}`);
    },
    [navigate]
  );
  const catalog = useMarketplaceCatalog(instance?._id ?? null);

  // Set from the query string an integration's OAuth callback redirects with.
  // Only the integration, a one-time code and an error code are read from it;
  // the text shown is fixed (lib/oauthErrors.ts). An `oauth_code` is redeemed
  // by moduleOAuth.finish, which only the member who started the connect can do.
  const [oauthResult, setOauthResult] = useState<OAuthResult | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const integration = params.get("integration");
    if (!integration) {
      return null;
    }
    const label = integrationLabel(integration);
    const oauthCode = params.get("oauth_code");
    if (oauthCode) {
      return { status: "finishing", connectCode: oauthCode, label };
    }
    if (params.get("status") === "error") {
      return { status: "error", message: oauthErrorMessage(params.get("error"), label) };
    }
    return null;
  });

  const finishModuleOAuth = useAction(api.moduleOAuth.finish);
  const { isAuthenticated } = useConvexAuth();
  const finishingCodeRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !isAuthenticated ||
      oauthResult?.status !== "finishing" ||
      finishingCodeRef.current === oauthResult.connectCode
    ) {
      return;
    }
    finishingCodeRef.current = oauthResult.connectCode;
    const { label } = oauthResult;
    finishModuleOAuth({ code: oauthResult.connectCode })
      .then((result) => {
        setOauthResult(
          result.ok
            ? { status: "connected", label }
            : { status: "error", message: oauthErrorMessage(result.error, label) }
        );
      })
      .catch((err: unknown) => {
        console.error("[modules] finishing the OAuth connect failed:", String(err));
        setOauthResult({ status: "error", message: oauthErrorMessage(null, label) });
      });
  }, [finishModuleOAuth, isAuthenticated, oauthResult]);

  const oauthUrlStrippedRef = useRef(false);
  useEffect(() => {
    if (!oauthResult || oauthUrlStrippedRef.current) {
      return;
    }
    oauthUrlStrippedRef.current = true;
    navigate(location, { replace: true });
  }, [location, navigate, oauthResult]);

  const [selectedModule, setSelectedModule] = useState<SelectedModule | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<{
    _id: Id<"moduleRepository">;
    name: string;
    version: string;
    moduleKey?: string;
  } | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const getModuleDetail = useAction(api.moduleDetail.getModuleDetail);
  const [moduleDetail, setModuleDetail] = useState<ModuleDetailResult | null>(null);
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
  const install = useModuleInstall(instance?._id, () => setDetailRefreshKey((key) => key + 1));

  const prevSelectedRef = useRef(selectedModule);
  useEffect(() => {
    if (prevSelectedRef.current !== selectedModule) {
      install.dismissError();
      setShowErrorDetails(false);
      prevSelectedRef.current = selectedModule;
    }
  }, [selectedModule, install]);

  const repoModules = useQuery(api.moduleRepository.list, instance ? { instanceId: instance._id } : "skip");

  const handleSelectInstalled = useCallback(
    (moduleId: Id<"moduleRepository">) => {
      const target = (repoModules || []).find((m) => m._id === moduleId);
      navigate(`/modules/${bareModuleKey(target?.moduleKey) ?? moduleId}`);
    },
    [navigate, repoModules]
  );

  useEffect(() => {
    if (routeModuleId === undefined) {
      setSelectedModule(null);
      return;
    }
    if (!repoModules) return;

    const byId = repoModules.find((m) => m._id === routeModuleId);
    if (byId) {
      setSelectedModule({
        source: "installed",
        module: {
          _id: byId._id,
          name: byId.name,
          description: byId.description,
          version: byId.version,
          tags: byId.tags,
          author: byId.author ?? "",
          category: byId.category ?? "Utilities",
          moduleKey: byId.moduleKey,
          isInstalled: byId.status === "installed",
          status: byId.status,
        },
      });
      return;
    }

    const byKey = repoModules.find((m) => m.moduleKey?.startsWith(routeModuleId + ":"));
    if (byKey) {
      setSelectedModule({ source: "marketplace", marketplaceId: routeModuleId });
      return;
    }

    setSelectedModule({ source: "marketplace", marketplaceId: routeModuleId });
  }, [routeModuleId, repoModules]);

  // An update started from the Installed list can be sitting on a `/modules/{convexId}` route (a
  // module with no moduleKey is addressed by _id), so land on the marketplace-id route the upgraded
  // module now answers to. Only ever re-routes a detail view onto itself: a route that already
  // matches would just churn the detail fetch below, and someone who has browsed back to the store
  // in the meantime should not be yanked out of it.
  useEffect(() => {
    if (!install.succeeded || !install.pendingModuleKey || routeModuleId === undefined) {
      return;
    }
    const marketplaceId = bareModuleKey(install.pendingModuleKey);
    if (marketplaceId && marketplaceId !== routeModuleId) {
      navigate(`/modules/${marketplaceId}`);
    }
  }, [install.succeeded, install.pendingModuleKey, routeModuleId, navigate]);

  // A stable primitive (not the selectedModule object itself, which gets a new reference on every
  // reactive repoModules update even when the logical selection hasn't changed) — keeps the fetch
  // below from re-running the slow getModuleDetail action on every unrelated moduleRepository write.
  const detailModuleId = useMemo(
    () =>
      selectedModule
        ? selectedModule.source === "marketplace"
          ? selectedModule.marketplaceId
          : selectedModule.module._id
        : null,
    [selectedModule]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: detailRefreshKey re-triggers the fetch, it is not a value read in the body
  useEffect(() => {
    if (!detailModuleId || !instance) {
      setModuleDetail(null);
      return;
    }
    setModuleDetailLoading(true);
    setModuleDetail(null);
    setModuleDetailError(null);
    let cancelled = false;
    void getModuleDetail({ instanceId: instance._id, moduleId: detailModuleId })
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
  }, [detailModuleId, detailRefreshKey, instance, getModuleDetail]);

  // Installing and updating are the same marketplace operation, and both need only the module's
  // marketplace id. An installed selection carries that id in its moduleKey, so deriving it here —
  // rather than reading it off a `source: "marketplace"` selection — is what makes Update reachable
  // from the Installed list and not only from the Store.
  const selectedMarketplaceId = useMemo(() => {
    if (!selectedModule) {
      return null;
    }
    if (selectedModule.source === "marketplace") {
      return selectedModule.marketplaceId;
    }
    return bareModuleKey(selectedModule.module.moduleKey) ?? null;
  }, [selectedModule]);

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
    if (selectedModule?.source !== "marketplace" || !repoModules) {
      return null;
    }
    const mpId = selectedModule.marketplaceId;
    return repoModules.find((m) => m.moduleKey?.startsWith(mpId + ":")) ?? null;
  }, [selectedModule, repoModules]);

  const handleDelete = (moduleId: Id<"moduleRepository">) => {
    const target = (repoModules || []).find((m) => m._id === moduleId);
    if (!target) {
      return;
    }
    setUninstallTarget({
      _id: moduleId,
      name: target.name,
      version: target.version,
      moduleKey: target.moduleKey,
    });
  };

  const handleUninstallSuccess = () => {
    setUninstallTarget(null);
    navigate("/modules");
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
      moduleDbId: moduleDetail.moduleDbId as Id<"moduleRepository"> | undefined,
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
      author: m.author,
      category: m.category,
      tags: m.tags,
      isInstalled: m.isInstalled,
      identifier: bareModuleKey(m.moduleKey),
    };
  }, [selectedModule]);

  const meta = detailProps?.meta ?? fallbackMeta;

  return (
    <div className="flex h-full overflow-hidden max-w-[1600px] w-full">
      <ModuleSidebar
        catalog={catalog.list}
        selectedCategory={selectedCategory}
        onSelectCategory={handleSelectCategory}
        selectedId={selectedModule?.source === "installed" ? selectedModule.module._id : null}
        onSelectModule={handleSelectInstalled}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
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
                    <Button variant="outline" size="sm" onClick={() => navigate("/modules")}>
                      Back
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : meta ? (
              <div className="flex-1 min-h-0 flex flex-col">
                {oauthResult && (
                  <div
                    className={`mx-6 mt-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${
                      oauthResult.status !== "error"
                        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                        : "border-destructive/30 bg-destructive/5 text-destructive"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {oauthResult.status === "finishing" ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      ) : oauthResult.status === "connected" ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {oauthResult.status === "finishing"
                        ? `Finishing the ${oauthResult.label} connection...`
                        : oauthResult.status === "connected"
                          ? `${oauthResult.label} connected successfully.`
                          : oauthResult.message}
                    </span>
                    <button type="button" onClick={() => setOauthResult(null)} className="shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
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
                    onBack={() => navigate("/modules")}
                    instanceId={instance?._id}
                    moduleDbId={detailProps?.moduleDbId}
                    manifestSettings={detailProps?.manifestSettings}
                    manifestResourceKinds={detailProps?.manifestResourceKinds}
                    permissions={detailProps?.permissions}
                    latestPermissions={detailProps?.latestPermissions}
                    localEndpoints={detailProps?.localEndpoints}
                    latestLocalEndpoints={detailProps?.latestLocalEndpoints}
                    onRemove={
                      selectedModule.source === "installed"
                        ? () => handleDelete(selectedModule.module._id)
                        : selectedModule.source === "marketplace" && installedModuleForMarketplace
                          ? () => handleDelete(installedModuleForMarketplace._id)
                          : undefined
                    }
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
          <ModuleStore
            catalog={catalog}
            selectedCategory={selectedCategory}
            onSelectCategory={handleSelectCategory}
            header={<PageIntro introId="modules" onTry={() => handleSelectCategory(PLATFORM_CATEGORY)} />}
          />
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

      {instance && (
        <UninstallModuleDialog
          open={uninstallTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setUninstallTarget(null);
            }
          }}
          instanceId={instance._id}
          module={uninstallTarget}
          onSuccess={handleUninstallSuccess}
        />
      )}
    </div>
  );
}
