import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import JSZip from "jszip";
import { CheckCircle2, FileCode, Loader2, Upload, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import {
  type ModuleDetailAction,
  type ModuleDetailFunction,
  type ModuleDetailMeta,
  ModuleDetailPanel,
  type ModuleDetailTrigger,
  type ModuleDetailWidget,
} from "@/components/modules/module-detail-panel";
import {
  type MarketplaceListItem,
  type ModuleListItem,
  ModulesSidebar,
  type SelectedModule,
} from "@/components/modules/modules-sidebar";
import { UninstallModuleDialog } from "@/components/modules/uninstall-module-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstance } from "@/hooks/use-instance";
import { cn } from "@/lib/utils";

interface UploadedFiles {
  [path: string]: string;
}

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

function getCommonDirectoryPrefix(paths: string[]): string {
  if (paths.length === 0) {
    return "";
  }
  const firstSlash = paths[0].indexOf("/");
  if (firstSlash === -1) {
    return "";
  }
  const candidate = paths[0].slice(0, firstSlash + 1);
  if (paths.every((p) => p.startsWith(candidate))) {
    return candidate;
  }
  return "";
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

export default function Modules() {
  const [, _navigate] = useLocation();
  const { instance } = useInstance();
  const [selectedModule, setSelectedModule] = useState<SelectedModule | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<{
    _id: Id<"moduleRepository">;
    name: string;
    version: string;
    moduleKey?: string;
  } | null>(null);

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFiles | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [pendingModuleKey, setPendingModuleKey] = useState<string | null>(null);
  const dragCounter = useRef(0);

  const generateUploadUrl = useMutation(api.assets.generateUploadUrl);
  const uploadAndDeliver = useMutation(api.moduleRepository.uploadAndDeliver);

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
        setUploadedFiles(null);
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

  const processZipFile = useCallback(async (file: File) => {
    try {
      const zip = await JSZip.loadAsync(file);
      const extractedFiles: UploadedFiles = {};

      await Promise.all(
        Object.keys(zip.files).map(async (filename) => {
          const zipEntry = zip.files[filename];
          if (!zipEntry.dir) {
            const content = await zipEntry.async("string");
            extractedFiles[filename] = content;
          }
        })
      );

      setUploadedFiles(extractedFiles);
    } catch {
      setInstallError("Failed to extract zip file. Please ensure it is a valid zip archive.");
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (!file) {
        return;
      }
      if (!file.name.endsWith(".zip")) {
        setInstallError("Please drop a .zip file.");
        return;
      }
      await processZipFile(file);
    },
    [processZipFile]
  );

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      await processZipFile(file);
    },
    [processZipFile]
  );

  const handleInstall = useCallback(async () => {
    if (!instance || !uploadedFiles) {
      setInstallError("No instance selected or no files uploaded.");
      return;
    }

    setIsInstalling(true);
    setInstallError(null);

    try {
      const zip = new JSZip();
      const paths = Object.keys(uploadedFiles);
      const commonPrefix = getCommonDirectoryPrefix(paths);
      for (const [path, content] of Object.entries(uploadedFiles)) {
        zip.file(path.slice(commonPrefix.length), content);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });

      const uploadUrl = await generateUploadUrl();
      const uploadResult = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: zipBlob,
      });
      if (!uploadResult.ok) {
        throw new Error("Upload failed");
      }
      const { storageId } = (await uploadResult.json()) as { storageId: Id<"_storage"> };

      const manifestContent =
        uploadedFiles["manifest.json"] ||
        uploadedFiles[Object.keys(uploadedFiles).find((f) => f.endsWith("manifest.json")) ?? ""];

      let manifest: Record<string, unknown> = {};
      if (manifestContent) {
        try {
          manifest = JSON.parse(manifestContent);
        } catch {}
      }

      const name = (manifest.name as string) || uploadedFiles[0]?.split("/")[0] || "Unknown Module";
      const description = (manifest.description as string) || "";
      const version = (manifest.version as string) || "1.0.0";
      const tags: string[] = Array.isArray(manifest.tags) ? (manifest.tags as string[]) : [];

      const moduleId = (manifest.id as string) || toSnakeCase(name);
      const zipArrayBuffer = await zipBlob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", zipArrayBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const shortHash = hashHex.slice(0, 7);
      const moduleKey = `${moduleId}:${version}:${shortHash}`;

      setPendingModuleKey(moduleKey);
      await uploadAndDeliver({
        instanceId: instance._id,
        moduleKey,
        name,
        description,
        version,
        tags,
        manifest,
        archiveKey: storageId,
      });
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : "Failed to install module.");
      setIsInstalling(false);
    }
  }, [instance, uploadedFiles, generateUploadUrl, uploadAndDeliver]);

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

  const clearUpload = () => {
    setUploadedFiles(null);
    setInstallError(null);
    setPendingModuleKey(null);
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

  const _unused: MarketplaceListItem | null = null;
  void _unused;

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <ModulesSidebar selected={selectedModule} onSelectModule={(s) => setSelectedModule(s)} />

      <div className="flex-1 overflow-auto">
        {selectedModule && detailProps ? (
          <>
            {selectedModule.source === "marketplace" && marketplaceDetailError ? (
              <div className="p-6">
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
              />
            )}
            {selectedModule.source === "marketplace" && (isInstalling || installEvent || installError) && (
              <div className="px-6 pb-6">
                <Card className="max-w-xl">
                  <CardContent className="pt-6">
                    {installEvent?.status === "success" ? (
                      <div className="flex items-center gap-3 text-green-500">
                        <CheckCircle2 className="h-5 w-5" />
                        <span>Module installed successfully!</span>
                      </div>
                    ) : isInstalling ? (
                      <div className="flex items-center gap-3 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{installEvent?.message ?? "Installing from marketplace..."}</span>
                      </div>
                    ) : installError ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-destructive">
                          <XCircle className="h-4 w-4 shrink-0" />
                          <span>Install failed</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          onClick={() => setShowErrorDetails(true)}
                        >
                          Show details
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        ) : (
          <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
            {uploadedFiles ? (
              <div className="mt-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-semibold">Module Ready to Install</h3>
                    <p className="text-sm text-muted-foreground">
                      {Object.keys(uploadedFiles).length} files extracted from zip
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={clearUpload}>
                    Cancel
                  </Button>
                </div>

                <Card className="max-w-md">
                  <CardContent className="pt-6">
                    {installEvent?.status === "success" ? (
                      <div className="flex items-center gap-3 text-green-500">
                        <CheckCircle2 className="h-5 w-5" />
                        <span>Module installed successfully!</span>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-3 mb-4">
                          {Object.keys(uploadedFiles)
                            .slice(0, 5)
                            .map((path) => (
                              <div key={path} className="flex items-center gap-2 text-sm">
                                <FileCode className="h-4 w-4 text-muted-foreground" />
                                <span className="truncate">{path}</span>
                              </div>
                            ))}
                          {Object.keys(uploadedFiles).length > 5 && (
                            <p className="text-sm text-muted-foreground">
                              ...and {Object.keys(uploadedFiles).length - 5} more files
                            </p>
                          )}
                        </div>
                        <Button className="w-full" onClick={handleInstall} disabled={isInstalling}>
                          {isInstalling ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Installing...
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4 mr-2" />
                              Upload and Install
                            </>
                          )}
                        </Button>
                        {installError && (
                          <div className="mt-3 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm text-destructive">
                              <XCircle className="h-4 w-4 shrink-0" />
                              <span>Install failed</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-muted-foreground"
                              onClick={() => setShowErrorDetails(true)}
                            >
                              Show details
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <>
                <PageHeader title="Modules" description="Browse and manage your stream automation modules." />

                {isLoading ? (
                  <div className="flex items-center justify-center min-h-[40vh]">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="mt-8">
                    <Card
                      className={cn(
                        "max-w-xl mx-auto transition-colors cursor-pointer",
                        isDragging && "border-primary border-2 bg-primary/5"
                      )}
                      onDragEnter={handleDragEnter}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <CardContent className="pt-12 pb-12">
                        <div className="flex flex-col items-center justify-center">
                          <Upload
                            className={cn("h-16 w-16 mb-4", isDragging ? "text-primary" : "text-muted-foreground")}
                          />
                          <h3 className="text-lg font-semibold mb-2">
                            {isDragging ? "Drop to upload" : "Select a module or Upload Module Zip"}
                          </h3>
                          <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
                            Drag and drop a module zip file here, or choose a module from the sidebar.
                          </p>
                          <label>
                            <input type="file" accept=".zip" onChange={handleFileUpload} className="hidden" />
                            <Button asChild>
                              <span>
                                <Upload className="h-4 w-4 mr-2" />
                                Choose Zip File
                              </span>
                            </Button>
                          </label>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="mt-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        Or select a module from the sidebar to view its details
                      </p>
                    </div>
                  </div>
                )}
              </>
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
