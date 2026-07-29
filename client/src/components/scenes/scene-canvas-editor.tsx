import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Grid, Link, Maximize, MoreVertical, Save, Settings, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import type { Scene, Widget } from "@/types";
import { CanvasWidgetHandle } from "./canvas-widget-handle";
import { LiveScenePreview } from "./live-scene-preview";
import { WidgetCatalogSidebar } from "./widget-catalog-sidebar";
import { WidgetSettingsPanel } from "./widget-settings-panel";

interface WidgetSettingField {
  key: string;
  fieldType: string;
  label: string;
  defaultValue: unknown;
  options?: Array<{ label: string; value: string }>;
}

interface SceneCanvasEditorProps {
  instanceId: Id<"instances">;
  engineSceneId: string;
}

export function SceneCanvasEditor({ instanceId, engineSceneId }: SceneCanvasEditorProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const fetchedScene = useQuery(api.scenes.getByEngineSceneId, { instanceId, engineSceneId });
  // undefined = loading; null = synced id not in the cache yet (webhook pending).
  const isLoading = fetchedScene === undefined;
  const isAwaitingSync = fetchedScene === null;

  const catalogWidgets = useQuery(api.sceneWidgets.listForInstance, { instanceId }) ?? [];

  const [scene, setScene] = useState<Scene | null>(null);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [showGrid, setShowGrid] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Local edits must survive the SCENE_UPDATED webhook re-push after a save.
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (fetchedScene && !isDirty) {
      setScene({
        id: fetchedScene._id as string,
        engineSceneId: fetchedScene.engineSceneId ?? "",
        name: fetchedScene.name,
        description: fetchedScene.description ?? "",
        width: fetchedScene.width ?? 1920,
        height: fetchedScene.height ?? 1080,
        backgroundColor: fetchedScene.backgroundColor ?? "transparent",
        widgets: (fetchedScene.widgets ?? []) as Widget[],
        createdAt: new Date(fetchedScene.createdAt).toISOString(),
        updatedAt: new Date(fetchedScene.updatedAt).toISOString(),
      });
    }
  }, [fetchedScene, isDirty]);

  const updateSceneAction = useAction(api.sceneActions.updateScene);
  const deleteSceneAction = useAction(api.sceneActions.deleteScene);
  const createSceneAction = useAction(api.sceneActions.createScene);
  const getOrCreateBrowserSourceKey = useMutation(api.browserSource.getOrCreateBrowserSourceKey);
  const rotateBrowserSourceKey = useMutation(api.browserSource.rotateBrowserSourceKey);

  const convexSceneId = fetchedScene?._id as Id<"scenes"> | undefined;

  const mutateScene = useCallback((updater: (prev: Scene) => Scene) => {
    setIsDirty(true);
    setScene((prev) => (prev ? updater(prev) : prev));
  }, []);

  const copyKeyToClipboard = useCallback(async (key: string) => {
    const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL ?? window.location.origin;
    const browserSourceUrl = `${siteUrl.replace(/\/+$/, "")}/browser-source/${key}`;
    await navigator.clipboard.writeText(browserSourceUrl);
    return browserSourceUrl;
  }, []);

  const handleCopyBrowserSource = useCallback(async () => {
    if (!convexSceneId) {
      return;
    }
    try {
      const key = await getOrCreateBrowserSourceKey({ sceneId: convexSceneId });
      const browserSourceUrl = await copyKeyToClipboard(key);
      toast({ title: "Browser source URL copied", description: browserSourceUrl });
    } catch (err) {
      toast({
        title: "Couldn't copy URL",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [convexSceneId, getOrCreateBrowserSourceKey, copyKeyToClipboard, toast]);

  const handleRotateBrowserSource = useCallback(async () => {
    if (!convexSceneId) {
      return;
    }
    try {
      const key = await rotateBrowserSourceKey({ sceneId: convexSceneId });
      await copyKeyToClipboard(key);
      toast({ title: "Browser source URL rotated", description: "Old URLs revoked. New URL copied." });
    } catch (err) {
      toast({
        title: "Couldn't rotate URL",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [convexSceneId, rotateBrowserSourceKey, copyKeyToClipboard, toast]);

  const handleSave = useCallback(async () => {
    if (!scene) {
      return;
    }
    setIsSaving(true);
    try {
      await updateSceneAction({
        instanceId,
        engineSceneId,
        name: scene.name,
        description: scene.description,
        widgetsJson: JSON.stringify(scene.widgets),
        layoutJson: JSON.stringify({
          width: scene.width,
          height: scene.height,
          backgroundColor: scene.backgroundColor,
        }),
      });
      setIsDirty(false);
      toast({ title: "Scene saved" });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [scene, instanceId, engineSceneId, updateSceneAction, toast]);

  const handleDeleteScene = useCallback(async () => {
    try {
      await deleteSceneAction({ instanceId, engineSceneId });
      toast({ title: "Scene deleted" });
      navigate("/scenes");
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [deleteSceneAction, instanceId, engineSceneId, navigate, toast]);

  const handleDuplicateScene = useCallback(async () => {
    if (!scene) {
      return;
    }
    try {
      const { engineSceneId: newId } = await createSceneAction({
        instanceId,
        name: `${scene.name} (Copy)`,
        description: scene.description || undefined,
        widgetsJson: JSON.stringify(scene.widgets),
        layoutJson: JSON.stringify({
          width: scene.width,
          height: scene.height,
          backgroundColor: scene.backgroundColor,
        }),
      });
      toast({ title: "Scene duplicated" });
      navigate(`/scenes/${newId}`);
    } catch (err) {
      toast({
        title: "Duplicate failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [scene, createSceneAction, instanceId, navigate, toast]);

  const updateWidgetProperty = useCallback(
    (widgetId: string, key: string, value: unknown) => {
      mutateScene((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) => (w.id === widgetId ? { ...w, settings: { ...w.settings, [key]: value } } : w)),
      }));
    },
    [mutateScene]
  );

  const handleMove = useCallback(
    (widgetId: string, dx: number, dy: number) => {
      mutateScene((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) =>
          w.id === widgetId
            ? { ...w, position: { x: Math.max(0, w.position.x + dx), y: Math.max(0, w.position.y + dy) } }
            : w
        ),
      }));
    },
    [mutateScene]
  );

  const handleResize = useCallback(
    (widgetId: string, width: number, height: number) => {
      mutateScene((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) => (w.id === widgetId ? { ...w, size: { width, height } } : w)),
      }));
    },
    [mutateScene]
  );

  const addWidget = useCallback(
    (canonicalId: string, displayName: string) => {
      const newWidget: Widget = {
        id: `w-${Date.now()}`,
        widgetCanonicalId: canonicalId,
        name: displayName,
        position: { x: 100, y: 100 },
        size: { width: 300, height: 200 },
        rotation: 0,
        opacity: 100,
        zIndex: (scene?.widgets.length ?? 0) + 1,
        locked: false,
        visible: true,
        settings: {},
      };
      mutateScene((prev) => ({ ...prev, widgets: [...prev.widgets, newWidget] }));
      setSelectedWidgetId(newWidget.id);
    },
    [scene?.widgets.length, mutateScene]
  );

  const deleteWidget = useCallback(
    (widgetId: string) => {
      mutateScene((prev) => ({ ...prev, widgets: prev.widgets.filter((w) => w.id !== widgetId) }));
      setSelectedWidgetId((id) => (id === widgetId ? null : id));
    },
    [mutateScene]
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading scene…</div>
      </div>
    );
  }

  if (isAwaitingSync || !scene) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
        <p className="text-muted-foreground">Waiting for the engine to sync this scene…</p>
        <p className="text-xs text-muted-foreground">This usually takes a moment after creating a scene.</p>
      </div>
    );
  }

  const selectedWidget = scene.widgets.find((w) => w.id === selectedWidgetId) ?? null;
  const selectedWidgetFields = (
    selectedWidget ? (catalogWidgets.find((c) => c.widgetId === selectedWidget.widgetCanonicalId)?.settings ?? []) : []
  ) as WidgetSettingField[];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Input
            value={scene.name}
            onChange={(e) => mutateScene((prev) => ({ ...prev, name: e.target.value }))}
            className="font-semibold border-none bg-transparent focus-visible:ring-0 w-56"
            data-testid="input-scene-name"
          />
          <Badge variant="secondary" className="shrink-0">
            {scene.width}x{scene.height}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Scene settings */}
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-scene-settings">
                    <Settings className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Scene settings</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-72 space-y-4">
              <div className="space-y-1">
                <Label className="text-xs">Description</Label>
                <Input
                  value={scene.description}
                  onChange={(e) => mutateScene((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional"
                  data-testid="input-scene-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Width</Label>
                  <Input
                    type="number"
                    value={scene.width}
                    onChange={(e) => mutateScene((prev) => ({ ...prev, width: Number(e.target.value) || 0 }))}
                    data-testid="input-scene-width"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Height</Label>
                  <Input
                    type="number"
                    value={scene.height}
                    onChange={(e) => mutateScene((prev) => ({ ...prev, height: Number(e.target.value) || 0 }))}
                    data-testid="input-scene-height"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Background</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={scene.backgroundColor === "transparent" ? "#000000" : scene.backgroundColor}
                    onChange={(e) => mutateScene((prev) => ({ ...prev, backgroundColor: e.target.value }))}
                    className="h-9 w-12 p-1 shrink-0"
                    data-testid="input-scene-bg"
                  />
                  <Input
                    value={scene.backgroundColor}
                    onChange={(e) => mutateScene((prev) => ({ ...prev, backgroundColor: e.target.value }))}
                    placeholder="transparent"
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Browser source */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" disabled={!convexSceneId} data-testid="button-browser-source">
                    <Link className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Browser Source URL</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyBrowserSource} data-testid="menu-copy-browser-source">
                <Link className="h-4 w-4 mr-2" />
                Copy URL
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRotateBrowserSource} data-testid="menu-rotate-browser-source">
                <Settings className="h-4 w-4 mr-2" />
                Rotate URL (revoke old)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button onClick={handleSave} disabled={isSaving || !isDirty} data-testid="button-save-scene">
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving…" : isDirty ? "Save" : "Saved"}
          </Button>

          {/* Scene actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-scene-menu">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDuplicateScene}>Duplicate scene</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={handleDeleteScene}
                data-testid="menu-delete-scene"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete scene
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Body: widget catalog | canvas | widget settings */}
      <div className="flex-1 flex overflow-hidden">
        <WidgetCatalogSidebar catalogWidgets={catalogWidgets} onAdd={addWidget} />

        {/* biome-ignore lint/a11y/noStaticElementInteractions: canvas background click deselects widgets */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only canvas surface */}
        <div className="flex-1 bg-muted/30 relative overflow-auto" onClick={() => setSelectedWidgetId(null)}>
          <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-card rounded-md border p-1 z-10">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}
              data-testid="button-zoom-out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              data-testid="button-zoom-in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <Toggle pressed={showGrid} onPressedChange={setShowGrid} size="sm" data-testid="button-toggle-grid">
              <Grid className="h-4 w-4" />
            </Toggle>
            <Button variant="ghost" size="icon" onClick={() => setZoom(0.5)} data-testid="button-fit">
              <Maximize className="h-4 w-4" />
            </Button>
          </div>

          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div
              className="relative bg-black/80 shadow-2xl"
              style={{
                width: scene.width * zoom,
                height: scene.height * zoom,
                backgroundImage: showGrid
                  ? "radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)"
                  : "none",
                backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
              }}
              data-testid="scene-canvas"
            >
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                  width: scene.width,
                  height: scene.height,
                }}
              >
                <LiveScenePreview
                  instanceId={instanceId}
                  engineSceneId={engineSceneId}
                  width={scene.width}
                  height={scene.height}
                />
                {scene.widgets.map((widget) => (
                  <CanvasWidgetHandle
                    key={widget.id}
                    widget={widget}
                    isSelected={selectedWidgetId === widget.id}
                    scale={zoom}
                    onSelect={() => setSelectedWidgetId(widget.id)}
                    onMove={(dx, dy) => handleMove(widget.id, dx, dy)}
                    onResize={(w, h) => handleResize(widget.id, w, h)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {selectedWidget && (
          <WidgetSettingsPanel
            widget={selectedWidget}
            fields={selectedWidgetFields}
            onChangeSetting={(key, value) => updateWidgetProperty(selectedWidget.id, key, value)}
            onDelete={() => deleteWidget(selectedWidget.id)}
          />
        )}
      </div>
    </div>
  );
}
