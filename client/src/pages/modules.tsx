import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import JSZip from "jszip";
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  Download,
  FileCode,
  Loader2,
  Puzzle,
  Trash2,
  Upload,
  Workflow as WorkflowIcon,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { ModulesSidebar, type ModuleListItem } from "@/components/modules/modules-sidebar";
import { UninstallModuleDialog } from "@/components/modules/uninstall-module-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstance } from "@/hooks/use-instance";
import { cn } from "@/lib/utils";

interface UploadedFiles {
  [path: string]: string;
}

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
    .replace(/[\s\-]+/g, "_")
    .toLowerCase();
}

const categoryIcons: Record<string, React.ReactNode> = {
  Chat: <Bell className="h-4 w-4" />,
  Alerts: <Bell className="h-4 w-4" />,
  Media: <Puzzle className="h-4 w-4" />,
  Audio: <Puzzle className="h-4 w-4" />,
  Automation: <Zap className="h-4 w-4" />,
  Integrations: <Puzzle className="h-4 w-4" />,
  Effects: <Puzzle className="h-4 w-4" />,
  Utilities: <Puzzle className="h-4 w-4" />,
};

export default function Modules() {
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const [selectedModule, setSelectedModule] = useState<ModuleListItem | null>(null);
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

  const installEvent = useQuery(
    api.transientEvents.get,
    instance && pendingModuleKey ? { instanceId: instance._id, correlationKey: pendingModuleKey } : "skip",
  );

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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.endsWith(".zip")) {
      setInstallError("Please drop a .zip file.");
      return;
    }
    await processZipFile(file);
  }, [processZipFile]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await processZipFile(file);
  }, [processZipFile]);

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
      if (!uploadResult.ok) throw new Error("Upload failed");
      const { storageId } = await uploadResult.json() as { storageId: Id<"_storage"> };

      const manifestContent =
        uploadedFiles["manifest.json"] ||
        uploadedFiles[Object.keys(uploadedFiles).find((f) => f.endsWith("manifest.json")) ?? ""];

      let manifest: Record<string, unknown> = {};
      if (manifestContent) {
        try { manifest = JSON.parse(manifestContent); } catch {}
      }

      const name = (manifest.name as string) || uploadedFiles[0]?.split("/")[0] || "Unknown Module";
      const description = (manifest.description as string) || "";
      const version = (manifest.version as string) || "1.0.0";
      const tags: string[] = Array.isArray(manifest.tags) ? (manifest.tags as string[]) : [];

      const moduleId = (manifest.id as string) || toSnakeCase(name);
      const zipArrayBuffer = await zipBlob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", zipArrayBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

  const repoModules = useQuery(
    api.moduleRepository.list,
    instance ? { instanceId: instance._id } : "skip",
  );
  const isLoading = !instance || repoModules === undefined;

  const triggers = useQuery(
    api.triggerDefinitions.listByModule,
    selectedModule ? { moduleId: selectedModule._id } : "skip",
  );
  const actions = useQuery(
    api.actionDefinitions.listByModule,
    selectedModule ? { moduleId: selectedModule._id } : "skip",
  );
  const functions = useQuery(
    api.moduleFunctions.listByModule,
    selectedModule ? { moduleId: selectedModule._id } : "skip",
  );
  const workflows = useQuery(
    api.workflows.listByModule,
    instance && selectedModule?.moduleKey
      ? { instanceId: instance._id, moduleKey: selectedModule.moduleKey }
      : "skip",
  );

  const handleDelete = (moduleId: Id<"moduleRepository">) => {
    const target = (repoModules || []).find((m) => m._id === moduleId);
    if (!target) return;
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

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <ModulesSidebar
        selectedModuleId={selectedModule?._id ?? null}
        onSelectModule={(module) => setSelectedModule(module)}
      />

      <div className="flex-1 overflow-auto">
        {selectedModule ? (
          <div className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <Button variant="ghost" size="icon" onClick={() => setSelectedModule(null)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold">{selectedModule.name}</h2>
                  {categoryIcons[selectedModule.category] && (
                    <span className="text-primary">{categoryIcons[selectedModule.category]}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{selectedModule.description}</p>
              </div>
              {selectedModule.isInstalled ? (
                <Button variant="destructive" size="sm" onClick={() => handleDelete(selectedModule._id)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove
                </Button>
              ) : (
                <Button size="sm" onClick={() => setIsDragging(true)}>
                  <Download className="h-4 w-4 mr-2" />
                  Install
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Version</span>
                    <span>{selectedModule.version}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Author</span>
                    <span>{selectedModule.author || "Unknown"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Category</span>
                    <Badge variant="outline" className="text-xs">{selectedModule.category}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant={selectedModule.isInstalled ? "secondary" : "outline"} className="text-xs">
                      {selectedModule.isInstalled ? (
                        <><Check className="h-3 w-3 mr-1" />Installed</>
                      ) : "Not installed"}
                    </Badge>
                  </div>
                  {selectedModule.tags.length > 0 && (
                    <div className="pt-2">
                      <span className="text-sm text-muted-foreground">Tags</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedModule.tags.slice(0, 4).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    Triggers
                    {triggers && <Badge variant="secondary" className="text-xs">{triggers.length}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {triggers === undefined ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : triggers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No triggers</p>
                  ) : (
                    <div className="space-y-2">
                      {triggers.slice(0, 5).map((trigger) => (
                        <div key={trigger._id} className="flex items-start gap-2">
                          <div
                            className="h-6 w-6 rounded flex items-center justify-center shrink-0 text-xs"
                            style={{ backgroundColor: `${trigger.color}20`, color: trigger.color }}
                          >
                            <Puzzle className="h-3 w-3" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{trigger.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{trigger.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Actions
                    {actions && <Badge variant="secondary" className="text-xs">{actions.length}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {actions === undefined ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : actions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No actions</p>
                  ) : (
                    <div className="space-y-2">
                      {actions.slice(0, 5).map((action) => (
                        <div key={action._id} className="flex items-start gap-2">
                          <div
                            className="h-6 w-6 rounded flex items-center justify-center shrink-0 text-xs"
                            style={{ backgroundColor: `${action.color}20`, color: action.color }}
                          >
                            <Zap className="h-3 w-3" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{action.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileCode className="h-4 w-4" />
                    Functions
                    {functions && <Badge variant="secondary" className="text-xs">{functions.length}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {functions === undefined ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : functions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No functions</p>
                  ) : (
                    <div className="space-y-2">
                      {functions.slice(0, 5).map((fn) => (
                        <div key={fn._id} className="flex items-start gap-2">
                          <div className="h-6 w-6 rounded flex items-center justify-center shrink-0 text-xs bg-muted text-muted-foreground">
                            <FileCode className="h-3 w-3" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{fn.functionName}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {fn.runtime ? `${fn.runtime} · ` : ""}{fn.qualifiedName}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <WorkflowIcon className="h-4 w-4" />
                    Workflows
                    {workflows && <Badge variant="secondary" className="text-xs">{workflows.length}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {workflows === undefined ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : workflows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No workflows</p>
                  ) : (
                    <div className="space-y-2">
                      {workflows.slice(0, 5).map((wf) => (
                        <div key={wf._id} className="flex items-start gap-2">
                          <div className="h-6 w-6 rounded flex items-center justify-center shrink-0 text-xs bg-muted text-muted-foreground">
                            <WorkflowIcon className="h-3 w-3" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {wf.definition?.name ?? "Unnamed workflow"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {wf.isEnabled ? "Enabled" : "Disabled"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
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
                  <Button variant="outline" size="sm" onClick={clearUpload}>Cancel</Button>
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
                          {Object.keys(uploadedFiles).slice(0, 5).map((path) => (
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
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Installing...</>
                          ) : (
                            <><Upload className="h-4 w-4 mr-2" />Upload and Install</>
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
                <PageHeader
                  title="Modules"
                  description="Browse and manage your stream automation modules."
                />

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
                          <Upload className={cn("h-16 w-16 mb-4", isDragging ? "text-primary" : "text-muted-foreground")} />
                          <h3 className="text-lg font-semibold mb-2">
                            {isDragging ? "Drop to upload" : "Select a module or Upload Module Zip"}
                          </h3>
                          <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
                            Drag and drop a module zip file here, or choose a module from the sidebar.
                          </p>
                          <label>
                            <input
                              type="file"
                              accept=".zip"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                            <Button asChild>
                              <span><Upload className="h-4 w-4 mr-2" />Choose Zip File</span>
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
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm">
            {installError}
          </pre>
        </DialogContent>
      </Dialog>

      {instance && (
        <UninstallModuleDialog
          open={uninstallTarget !== null}
          onOpenChange={(open) => {
            if (!open) setUninstallTarget(null);
          }}
          instanceId={instance._id}
          module={uninstallTarget}
          onSuccess={handleUninstallSuccess}
        />
      )}
    </div>
  );
}