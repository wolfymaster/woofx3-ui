import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { ArrowLeft, Link, MoreVertical, Save, Settings, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import { useToast } from "@/hooks/use-toast";
import { browserSourceUrlForKey } from "@/lib/browser-source-url";
import { placeableOn } from "@/lib/widget-surfaces";
import type { Scene, Widget } from "@/types";
import { LiveScenePreview } from "./live-scene-preview";
import { WidgetLayoutCanvas, type WidgetsUpdate } from "./widget-layout-canvas";

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

  const catalogWidgets = useQuery(api.sceneWidgets.listForInstance, { instanceId });
  const sceneCatalog = useMemo(() => placeableOn(catalogWidgets ?? [], "scene"), [catalogWidgets]);

  const [scene, setScene] = useState<Scene | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Local edits must survive the SCENE_UPDATED webhook re-push after a save.
  const [isDirty, setIsDirty] = useState(false);
  // `updatedAt` of the snapshot a save was made against. A save clears isDirty as
  // soon as the engine accepts it, but the engine's SCENE_UPDATED echo takes a
  // moment to travel back through the webhook into this query — and until it
  // lands, the query is still serving the PRE-save snapshot. Adopting that would
  // roll the editor back to before the save and then forward again when the echo
  // arrives: a just-added widget disappears and returns, and the settings panel
  // bound to it flashes shut and open. Snapshots at or below the watermark are
  // that stale pre-save state; the echo is the first one above it.
  const echoWatermark = useRef(0);

  useEffect(() => {
    if (fetchedScene && !isDirty && fetchedScene.updatedAt > echoWatermark.current) {
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
  const getOrCreateBrowserSourceKey = useAction(api.browserSource.getOrCreateBrowserSourceKey);
  const rotateBrowserSourceKey = useAction(api.browserSource.rotateBrowserSourceKey);

  const convexSceneId = fetchedScene?._id as Id<"scenes"> | undefined;

  const mutateScene = useCallback((updater: (prev: Scene) => Scene) => {
    setIsDirty(true);
    setScene((prev) => (prev ? updater(prev) : prev));
  }, []);

  const copyKeyToClipboard = useCallback(async (key: string) => {
    const browserSourceUrl = browserSourceUrlForKey(key);
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

  // Takes the scene to persist rather than reading state, so a caller that just
  // built the next scene (a widget add) can save it without waiting for a re-render.
  const persistScene = useCallback(
    async (next: Scene, { silent = false }: { silent?: boolean } = {}) => {
      setIsSaving(true);
      // Everything this query serves until the echo lands describes the scene as
      // it was before this save.
      echoWatermark.current = fetchedScene?.updatedAt ?? echoWatermark.current;
      try {
        await updateSceneAction({
          instanceId,
          engineSceneId,
          name: next.name,
          description: next.description,
          widgetsJson: JSON.stringify(next.widgets),
          layoutJson: JSON.stringify({
            width: next.width,
            height: next.height,
            backgroundColor: next.backgroundColor,
          }),
        });
        setIsDirty(false);
        if (!silent) {
          toast({ title: "Scene saved" });
        }
        return true;
      } catch (err) {
        toast({
          title: "Save failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [instanceId, engineSceneId, updateSceneAction, toast, fetchedScene?.updatedAt]
  );

  const handleSave = useCallback(async () => {
    if (!scene) {
      return;
    }
    await persistScene(scene);
  }, [scene, persistScene]);

  const handleDeleteScene = useCallback(async () => {
    try {
      await deleteSceneAction({ instanceId, engineSceneId });
      toast({ title: "Scene deleted" });
      navigate("/stream/scenes");
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
      navigate(`/stream/scenes/${newId}`);
    } catch (err) {
      toast({
        title: "Duplicate failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [scene, createSceneAction, instanceId, navigate, toast]);

  const handleWidgetsChange = useCallback(
    (update: WidgetsUpdate, change: "add" | "edit") => {
      if (change === "edit") {
        mutateScene((prev) => ({ ...prev, widgets: update(prev.widgets) }));
        return;
      }
      if (!scene) {
        return;
      }
      const next: Scene = { ...scene, widgets: update(scene.widgets) };
      setIsDirty(true);
      setScene(next);
      // Persist immediately: the preview is the engine's own overlay, so a widget
      // that exists only in local state renders nothing at all. This save (and the
      // overlay reload the engine pushes after it) is what makes adding a widget
      // show the widget.
      void persistScene(next, { silent: true });
    },
    [scene, mutateScene, persistScene]
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

  const header = (
    <div className="h-14 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <Button variant="ghost" size="icon" onClick={() => navigate("/stream/scenes")} title="Back to scenes">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Input
          value={scene.name}
          onChange={(e) => mutateScene((prev) => ({ ...prev, name: e.target.value }))}
          className="font-semibold border-none bg-transparent focus-visible:ring-0 w-56"
          data-testid="input-scene-name"
        />
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
  );

  return (
    <WidgetLayoutCanvas
      header={header}
      width={scene.width}
      height={scene.height}
      widgets={scene.widgets}
      catalog={sceneCatalog}
      renderers={configFieldRenderers}
      onChange={handleWidgetsChange}
      preview={
        <LiveScenePreview sceneId={convexSceneId} width={scene.width} height={scene.height} widgets={scene.widgets} />
      }
    />
  );
}
