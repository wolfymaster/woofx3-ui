import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ModuleDetailResult } from "@convex/moduleDetail";
import { useAction, useQuery } from "convex/react";
import { Check, Loader2, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { type ModuleDetailMeta, ModuleDetailPanel } from "@/components/modules/module-detail-panel";
import { ModuleSidebar } from "@/components/modules/module-sidebar";
import { ModuleStore } from "@/components/modules/module-store";
import { UninstallModuleDialog } from "@/components/modules/uninstall-module-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstance } from "@/hooks/use-instance";
import { useMarketplaceCatalog } from "@/hooks/use-marketplace-catalog";

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

type SelectedModule =
  | { source: "installed"; module: ModuleListItem }
  | { source: "marketplace"; marketplaceId: string };

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
  const catalog = useMarketplaceCatalog();

  const [oauthResult, setOauthResult] = useState<{
    integration: string;
    status: string;
    message: string | null;
  } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const integration = params.get("integration");
    const status = params.get("status");
    if (!integration || !status) {
      return null;
    }
    return { integration, status, message: params.get("message") };
  });

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
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [pendingModuleKey, setPendingModuleKey] = useState<string | null>(null);
  const dismissInstallError = useCallback(() => {
    setInstallError(null);
    setShowErrorDetails(false);
  }, []);

  const getModuleDetail = useAction(api.moduleDetail.getModuleDetail);
  const [moduleDetail, setModuleDetail] = useState<ModuleDetailResult | null>(null);
  const [moduleDetailLoading, setModuleDetailLoading] = useState(false);
  const [moduleDetailError, setModuleDetailError] = useState<string | null>(null);

  const prevSelectedRef = useRef(selectedModule);
  useEffect(() => {
    if (prevSelectedRef.current !== selectedModule) {
      setInstallError(null);
      setShowErrorDetails(false);
      prevSelectedRef.current = selectedModule;
    }
  }, [selectedModule]);

  const installMarketplaceModule = useAction(api.marketplace.installModule);

  const installEvent = useQuery(
    api.transientEvents.get,
    instance && pendingModuleKey ? { instanceId: instance._id, correlationKey: pendingModuleKey } : "skip"
  );

  const repoModules = useQuery(api.moduleRepository.list, instance ? { instanceId: instance._id } : "skip");

  const handleSelectInstalled = useCallback(
    (moduleId: Id<"moduleRepository">) => {
      const target = (repoModules || []).find((m) => m._id === moduleId);
      const mk = target?.moduleKey;
      if (mk) {
        const parts = mk.split(":");
        if (parts[0]) {
          navigate(`/modules/${parts[0]}`);
          return;
        }
      }
      navigate(`/modules/${moduleId}`);
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

  useEffect(() => {
    if (selectedModule?.source !== "marketplace" || !pendingModuleKey) {
      return;
    }
    if (installEvent?.status === "success") {
      const mpId = pendingModuleKey.split(":")[0];
      if (mpId) {
        navigate(`/modules/${mpId}`);
      }
    }
  }, [installEvent, pendingModuleKey, selectedModule, navigate]);

  useEffect(() => {
    if (installEvent?.status === "success") {
      const timer = setTimeout(() => {
        setIsInstalling(false);
        setPendingModuleKey(null);
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (installEvent?.status === "error") {
      setInstallError(installEvent.message || "Module installation failed on the engine.");
      setIsInstalling(false);
      setPendingModuleKey(null);
    }
  }, [installEvent]);

  useEffect(() => {
    if (!isInstalling || !pendingModuleKey) {
      return;
    }
    const timer = setTimeout(() => {
      setInstallError("Installation timed out. The engine did not respond within 60 seconds.");
      setIsInstalling(false);
      setPendingModuleKey(null);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [isInstalling, pendingModuleKey]);

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
  }, [detailModuleId, instance, getModuleDetail]);

  const handleMarketplaceInstall = useCallback(async () => {
    if (!instance || selectedModule?.source !== "marketplace") {
      return;
    }
    setIsInstalling(true);
    setInstallError(null);
    try {
      const { moduleKey } = await installMarketplaceModule({
        instanceId: instance._id,
        marketplaceModuleId: selectedModule.marketplaceId,
      });
      setPendingModuleKey(moduleKey);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Failed to install marketplace module.");
      setIsInstalling(false);
    }
  }, [instance, selectedModule, installMarketplaceModule]);

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
      identifier: m.moduleKey?.split(":")[0],
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
                      oauthResult.status === "connected"
                        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                        : "border-destructive/30 bg-destructive/5 text-destructive"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {oauthResult.status === "connected" ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {oauthResult.status === "connected"
                        ? `${oauthResult.integration} connected successfully.`
                        : (oauthResult.message ?? `Failed to connect ${oauthResult.integration}.`)}
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
                    onRemove={
                      selectedModule.source === "installed"
                        ? () => handleDelete(selectedModule.module._id)
                        : selectedModule.source === "marketplace" && installedModuleForMarketplace
                          ? () => handleDelete(installedModuleForMarketplace._id)
                          : undefined
                    }
                    onInstall={selectedModule.source === "marketplace" ? handleMarketplaceInstall : undefined}
                    onUpdate={selectedModule.source === "marketplace" ? handleMarketplaceInstall : undefined}
                    isInstalling={isInstalling}
                    installDisabled={meta.isInstalled}
                    installDisabledReason={meta.isInstalled ? "Already installed" : undefined}
                    installProgressMessage={isInstalling ? (installEvent?.message ?? null) : null}
                    installSucceeded={installEvent?.status === "success"}
                    installError={installError}
                    onDismissError={dismissInstallError}
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
          <ModuleStore catalog={catalog} selectedCategory={selectedCategory} onSelectCategory={handleSelectCategory} />
        )}
      </div>

      <Dialog open={showErrorDetails} onOpenChange={setShowErrorDetails}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install Failed</DialogTitle>
          </DialogHeader>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm">{installError}</pre>
        </DialogContent>
      </Dialog>

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
