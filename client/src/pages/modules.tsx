import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { Loader2, Puzzle, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import {
  type ModuleDetailAction,
  type ModuleDetailFunction,
  type ModuleDetailMeta,
  ModuleDetailPanel,
  type ModuleDetailTrigger,
  type ModuleDetailWidget,
} from "@/components/modules/module-detail-panel";
import { type ModuleListItem, ModulesSidebar, type SelectedModule } from "@/components/modules/modules-sidebar";
import { UninstallModuleDialog } from "@/components/modules/uninstall-module-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstance } from "@/hooks/use-instance";

type MarketplaceDetail = {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  iconUrl?: string;
  readme?: string;
  triggers: Array<{ slug: string; name: string; description: string; color: string; icon?: string }>;
  actions: Array<{ slug: string; name: string; description: string; color: string; icon?: string }>;
  functions: Array<{ qualifiedName: string; runtime?: string }>;
  widgets: Array<{ slug: string; name: string }>;
  counts: { triggers: number; actions: number; functions: number; widgets: number };
};

export default function Modules() {
  const { instance } = useInstance();
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

  const installMarketplaceModule = useAction(api.marketplace.installModule);
  const getMarketplaceModule = useAction(api.marketplace.getModule);

  const installEvent = useQuery(
    api.transientEvents.get,
    instance && pendingModuleKey ? { instanceId: instance._id, correlationKey: pendingModuleKey } : "skip"
  );

  const repoModules = useQuery(api.moduleRepository.list, instance ? { instanceId: instance._id } : "skip");

  // Marketplace detail state (only relevant when source === "marketplace")
  const [marketplaceDetail, setMarketplaceDetail] = useState<MarketplaceDetail | null>(null);
  const [marketplaceDetailLoading, setMarketplaceDetailLoading] = useState(false);
  const [marketplaceDetailError, setMarketplaceDetailError] = useState<string | null>(null);

  // Fetch marketplace detail when a marketplace module is selected
  useEffect(() => {
    if (selectedModule?.source !== "marketplace") {
      setMarketplaceDetail(null);
      setMarketplaceDetailError(null);
      return;
    }
    const marketplaceId = selectedModule.marketplaceId;
    setMarketplaceDetailLoading(true);
    setMarketplaceDetailError(null);
    setMarketplaceDetail(null);
    let cancelled = false;
    void getMarketplaceModule({ marketplaceModuleId: marketplaceId })
      .then((detail) => {
        if (!cancelled) {
          setMarketplaceDetail(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMarketplaceDetailError(err instanceof Error ? err.message : "Failed to load module details.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMarketplaceDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedModule, getMarketplaceModule]);

  // Resolve installed-side detail (triggers/actions) only when a real installed module is selected.
  const selectedInstalled = selectedModule?.source === "installed" ? selectedModule.module : null;
  const installedTriggers = useQuery(
    api.triggerDefinitions.listByModule,
    selectedInstalled ? { moduleId: selectedInstalled._id } : "skip"
  );
  const installedActions = useQuery(
    api.actionDefinitions.listByModule,
    selectedInstalled ? { moduleId: selectedInstalled._id } : "skip"
  );

  // When a marketplace install completes, swap to the new installed module so the user stays put.
  useEffect(() => {
    if (selectedModule?.source !== "marketplace") {
      return;
    }
    if (installEvent?.status !== "success" || !pendingModuleKey) {
      return;
    }
    const installed = (repoModules || []).find((m) => m.moduleKey === pendingModuleKey);
    if (!installed) {
      return;
    }
    const moduleListItem: ModuleListItem = {
      _id: installed._id,
      name: installed.name,
      description: installed.description,
      version: installed.version,
      tags: installed.tags,
      author: installed.author ?? "",
      category: installed.category ?? "Utilities",
      moduleKey: installed.moduleKey,
      isInstalled: installed.status === "installed",
      status: installed.status,
    };
    setSelectedModule({ source: "installed", module: moduleListItem });
  }, [installEvent, pendingModuleKey, repoModules, selectedModule]);

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

  const isLoading = !instance || repoModules === undefined;

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
    setSelectedModule(null);
  };

  // Build the props for ModuleDetailPanel based on the selected source.
  const detailProps = useMemo(() => {
    if (!selectedModule) {
      return null;
    }
    if (selectedModule.source === "installed") {
      const m = selectedModule.module;
      const meta: ModuleDetailMeta = {
        name: m.name,
        description: m.description,
        version: m.version,
        author: m.author,
        category: m.category,
        tags: m.tags,
        isInstalled: m.isInstalled,
        identifier: m.moduleKey,
      };
      const triggers: ModuleDetailTrigger[] | undefined = installedTriggers?.map((t) => ({
        key: t._id,
        name: t.name,
        description: t.description,
        color: t.color,
      }));
      const actions: ModuleDetailAction[] | undefined = installedActions?.map((a) => ({
        key: a._id,
        name: a.name,
        description: a.description,
        color: a.color,
      }));
      const functions: ModuleDetailFunction[] = [];
      return { meta, triggers, actions, functions, widgets: undefined as ModuleDetailWidget[] | undefined };
    }
    // marketplace
    if (!marketplaceDetail) {
      const placeholder: ModuleDetailMeta = {
        name: "Loading…",
        description: "",
        version: "",
        author: "",
        category: "Utilities",
        tags: [],
        isInstalled: false,
      };
      return {
        meta: placeholder,
        triggers: undefined,
        actions: undefined,
        functions: undefined,
        widgets: undefined,
      };
    }
    const installed = (repoModules || []).some((r) => {
      if (!r.moduleKey) {
        return false;
      }
      const parts = r.moduleKey.split(":");
      return parts[0] === marketplaceDetail.id && parts[1] === marketplaceDetail.version;
    });
    const meta: ModuleDetailMeta = {
      name: marketplaceDetail.name,
      description: marketplaceDetail.description,
      version: marketplaceDetail.version,
      author: marketplaceDetail.author,
      category: marketplaceDetail.category,
      tags: marketplaceDetail.tags,
      isInstalled: installed,
      iconUrl: marketplaceDetail.iconUrl,
      readme: marketplaceDetail.readme,
      identifier: marketplaceDetail.id,
    };
    return {
      meta,
      triggers: marketplaceDetail.triggers.map((t) => ({
        key: t.slug,
        name: t.name,
        description: t.description,
        color: t.color,
      })),
      actions: marketplaceDetail.actions.map((a) => ({
        key: a.slug,
        name: a.name,
        description: a.description,
        color: a.color,
      })),
      functions: marketplaceDetail.functions,
      widgets: marketplaceDetail.widgets,
    };
  }, [selectedModule, installedTriggers, installedActions, marketplaceDetail, repoModules]);

  return (
    <div className="flex h-[calc(100vh-4rem)] max-w-[1600px] w-full">
      <ModulesSidebar selected={selectedModule} onSelectModule={(s) => setSelectedModule(s)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedModule && detailProps ? (
          <>
            {selectedModule.source === "marketplace" && marketplaceDetailError ? (
              <div className="p-6 overflow-auto">
                <Card className="max-w-xl">
                  <CardContent className="pt-6 space-y-3">
                    <div className="flex items-center gap-2 text-destructive">
                      <XCircle className="h-4 w-4" />
                      <span className="font-medium">Failed to load module</span>
                    </div>
                    <p className="text-sm text-muted-foreground break-words">{marketplaceDetailError}</p>
                    <Button variant="outline" size="sm" onClick={() => setSelectedModule(null)}>
                      Back
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <ModuleDetailPanel
                  module={detailProps.meta}
                  triggers={detailProps.triggers}
                  actions={detailProps.actions}
                  functions={detailProps.functions}
                  widgets={detailProps.widgets}
                  loading={selectedModule.source === "marketplace" && marketplaceDetailLoading}
                  onBack={() => setSelectedModule(null)}
                  onRemove={
                    selectedModule.source === "installed" ? () => handleDelete(selectedModule.module._id) : undefined
                  }
                  onInstall={selectedModule.source === "marketplace" ? handleMarketplaceInstall : undefined}
                  isInstalling={isInstalling}
                  installDisabled={detailProps.meta.isInstalled}
                  installDisabledReason={detailProps.meta.isInstalled ? "Already installed" : undefined}
                  installProgressMessage={isInstalling ? (installEvent?.message ?? null) : null}
                  installSucceeded={installEvent?.status === "success"}
                  installError={installError}
                  onShowInstallError={() => setShowErrorDetails(true)}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 overflow-auto p-6 lg:p-8 max-w-[1600px] mx-auto w-full">
            <PageHeader title="Modules" description="Browse and manage your stream automation modules." />

            {isLoading ? (
              <div className="flex items-center justify-center min-h-[40vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="mt-8 flex flex-col items-center justify-center text-center min-h-[40vh]">
                <Puzzle className="h-16 w-16 mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">Select a module</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Choose a module from the sidebar to view its details, available triggers and actions, and installation
                  status.
                </p>
              </div>
            )}
          </div>
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
