import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SceneSyncState } from "@woofx3/api/scene-editor/client";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Link, Loader2, MoreVertical, Save, Settings, Trash2, Undo2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { useSceneEditorSession } from "@/hooks/use-scene-editor-session";
import { useToast } from "@/hooks/use-toast";
import { browserSourceUrlForKey } from "@/lib/browser-source-url";
import type { Version } from "@/lib/scene-document";
import { canvasEdit, canvasOfDocument, type SceneCanvas } from "@/lib/scene-document-widgets";
import { placeableOn } from "@/lib/widget-surfaces";
import type { Scene, Widget } from "@/types";
import { LiveScenePreview } from "./live-scene-preview";
import { WidgetLayoutCanvas, type WidgetsUpdate } from "./widget-layout-canvas";

interface SceneCanvasEditorProps {
  instanceId: Id<"instances">;
  engineSceneId: string;
}

type DraftCommand = "publish" | "discard";

export function SceneCanvasEditor({ instanceId, engineSceneId }: SceneCanvasEditorProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const fetchedScene = useQuery(api.scenes.getByEngineSceneId, { instanceId, engineSceneId });
  // undefined = loading; null = synced id not in the cache yet (webhook pending).
  const isLoading = fetchedScene === undefined;
  const isAwaitingSync = fetchedScene === null;

  const catalogWidgets = useQuery(api.sceneWidgets.listForInstance, { instanceId });
  const sceneCatalog = useMemo(() => placeableOn(catalogWidgets ?? [], "scene"), [catalogWidgets]);

  // With the Save button: the whole scene as edited. In session mode: the
  // scene's name and description, which are not part of the scene document,
  // and the cached canvas shown until the session has loaded the scene.
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

  // An engine with editor sync edits the scene live through sceneManager:
  // every change is sent as it is made and saved for you, into a draft OBS
  // does not show until it is published. Other engines save with the button.
  // An engine that speaks only the older editor socket protocol is told to
  // upgrade: this dashboard no longer speaks it.
  // Once seen, the capability holds for as long as the editor is open: the
  // capabilities reload after an engine reconnect, and dropping to the
  // Save-button editor meanwhile would swap the published scene from the
  // cache in for the draft on the canvas. The editor is keyed by instance
  // (see pages/scenes.tsx), so another instance starts over and has to show
  // the capability itself.
  const capabilities = useEngineCapabilities(instanceId);
  const syncSupported = capabilities.support("scenes.editorSync") === "supported";
  const needsEngineUpgrade = !syncSupported && capabilities.support("scenes.editorSessions") === "supported";
  const [sessionMode, setSessionMode] = useState(syncSupported);
  if (syncSupported && !sessionMode) {
    setSessionMode(true);
  }

  // Live editing: this editor's changes go straight to what OBS shows, and
  // are copied into the draft so a later publish cannot undo them. Each open
  // editor chooses for itself, and every one starts on the draft.
  const [live, setLive] = useState(false);
  const uiVersion: Version = live ? "published" : "draft";
  const convexSceneId = fetchedScene?._id as Id<"scenes"> | undefined;

  const me = useQuery(api.users.getMe);
  const myName = me === undefined ? undefined : (me?.name ?? me?.email ?? "");
  const session = useSceneEditorSession({
    instanceId,
    engineSceneId,
    sceneId: convexSceneId,
    enabled: sessionMode,
    editorName: myName,
    unsavedOutsideSession: sessionMode && isDirty,
  });
  const client = session.client;
  const syncState = session.state;
  const sessionDoc = syncState?.local?.[uiVersion] ?? null;
  const sessionCanvas = useMemo(() => (sessionDoc === null ? null : canvasOfDocument(sessionDoc)), [sessionDoc]);
  const conn = syncState?.conn ?? null;
  const sessionEnded = sessionMode && (conn === "gone" || conn === "closed");
  // The canvas takes edits only once the session has the scene, and not after it ended.
  const canvasReadOnly = sessionMode && (sessionCanvas === null || sessionEnded);
  const pendingCommand = syncState?.pendingCommand ?? null;
  // One Publish or Discard at a time; editing goes on while one is queued,
  // and edits made after it are transformed against its result.
  const draftCommandsEnabled =
    syncState !== null &&
    sessionDoc !== null &&
    !sessionEnded &&
    pendingCommand === null &&
    (syncState.hasDraft || syncState.pendingItems > 0);

  // Who else is editing this version, and where: other editors' selections,
  // in a colour each keeps for as long as it is connected.
  const [selection, setSelection] = useState<string | null>(null);
  useEffect(() => {
    client?.setPresence(selection, uiVersion);
  }, [client, selection, uiVersion]);
  const peers = syncState?.peers;
  const remoteSelections = useMemo(() => {
    const byWidget: Record<string, { name: string; color: string }[]> = {};
    for (const peer of peers ?? []) {
      if (peer.selection !== null && peer.version === uiVersion) {
        const editors = byWidget[peer.selection] ?? [];
        editors.push({ name: peer.name, color: editorColor(peer.clientId) });
        byWidget[peer.selection] = editors;
      }
    }
    return byWidget;
  }, [peers, uiVersion]);

  useEffect(() => {
    if (!fetchedScene) {
      return;
    }
    if (sessionMode) {
      // Only the starting name and description come from the cache: they
      // are edited here and saved, and its later pushes would undo typing.
      setScene((prev) => prev ?? sceneOf(fetchedScene));
      return;
    }
    if (!isDirty && fetchedScene.updatedAt > echoWatermark.current) {
      setScene(sceneOf(fetchedScene));
    }
  }, [fetchedScene, isDirty, sessionMode]);

  // The scene as the editor shows it: in session mode, the session's
  // document of the version being edited, with the scene's own name and
  // description.
  const shownScene = useMemo(
    () => (scene !== null && sessionMode && sessionCanvas !== null ? { ...scene, ...sessionCanvas } : scene),
    [scene, sessionMode, sessionCanvas]
  );

  const updateSceneAction = useAction(api.sceneActions.updateScene);
  const deleteSceneAction = useAction(api.sceneActions.deleteScene);
  const createSceneAction = useAction(api.sceneActions.createScene);
  const getOrCreateBrowserSourceKey = useAction(api.browserSource.getOrCreateBrowserSourceKey);
  const rotateBrowserSourceKey = useAction(api.browserSource.rotateBrowserSourceKey);

  // In session mode an edit goes straight to the client as a function of the
  // document it holds (`canvasEdit`), never from an effect on the scene: a
  // render that follows another editor's change cannot send back the canvas
  // it replaced, and the canvas shows the client's document, edit included.
  const mutateCanvas = useCallback(
    (update: (canvas: SceneCanvas) => SceneCanvas) => {
      if (!sessionMode) {
        setScene((prev) => (prev === null ? prev : { ...prev, ...update(prev) }));
        setIsDirty(true);
        return;
      }
      if (client === null) {
        return;
      }
      const result = client.edit(uiVersion, canvasEdit(update));
      if (!result.ok) {
        toast({ title: "This change couldn't be made", description: result.detail, variant: "destructive" });
      }
    },
    [sessionMode, client, uiVersion, toast]
  );

  const updateDetails = useCallback((details: Partial<Pick<Scene, "name" | "description">>) => {
    setScene((prev) => (prev === null ? prev : { ...prev, ...details }));
    setIsDirty(true);
  }, []);

  // In session mode the name and description, which are not part of the
  // document, save themselves a moment after typing stops, or at once when
  // the editor closes first.
  const sceneName = scene?.name;
  const sceneDescription = scene?.description;
  const saveNameAndDescription = useCallback(
    (name: string, description: string | undefined) => {
      updateSceneAction({ instanceId, engineSceneId, name, description }).catch((err) =>
        toast({
          title: "Couldn't save the scene's name",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        })
      );
    },
    [updateSceneAction, instanceId, engineSceneId, toast]
  );
  const unsavedNameRef = useRef<{ name: string; description: string | undefined } | null>(null);
  // While the scene is being deleted its name is not saved: that would only
  // fail, or race the delete. The delete owns the unsaved name meanwhile: it
  // drops it when the delete succeeds and saves it when the delete fails,
  // whether or not the editor is still open. `deletingRef` is what the save
  // on close reads, as it sees no render.
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const saveNameRef = useRef(saveNameAndDescription);
  saveNameRef.current = saveNameAndDescription;
  // Read from refs, so it saves the latest name even once the editor has closed.
  const saveUnsavedName = useCallback(() => {
    const unsaved = unsavedNameRef.current;
    if (!unsaved) {
      return;
    }
    unsavedNameRef.current = null;
    if (mountedRef.current) {
      setIsDirty(false);
    }
    saveNameRef.current(unsaved.name, unsaved.description);
  }, []);
  useEffect(() => {
    if (!sessionMode || !isDirty || sceneName === undefined) {
      unsavedNameRef.current = null;
      return;
    }
    unsavedNameRef.current = { name: sceneName, description: sceneDescription };
    if (deleting) {
      return;
    }
    const timer = setTimeout(saveUnsavedName, 800);
    return () => clearTimeout(timer);
  }, [sessionMode, isDirty, sceneName, sceneDescription, deleting, saveUnsavedName]);
  useEffect(() => {
    return () => {
      if (!deletingRef.current) {
        saveUnsavedName();
      }
    };
  }, [saveUnsavedName]);

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

  const handleSave = useCallback(async () => {
    if (!scene) {
      return;
    }
    setIsSaving(true);
    // Everything this query serves until the echo lands describes the scene as
    // it was before this save.
    echoWatermark.current = fetchedScene?.updatedAt ?? echoWatermark.current;
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
  }, [scene, instanceId, engineSceneId, updateSceneAction, toast, fetchedScene?.updatedAt]);

  const abandonSession = session.abandon;
  const handleDeleteScene = useCallback(async () => {
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteSceneAction({ instanceId, engineSceneId });
      unsavedNameRef.current = null;
      // Edits still on their way would only be resent to a scene that is gone,
      // including by a session left draining if the editor closed meanwhile.
      abandonSession();
      toast({ title: "Scene deleted" });
      navigate("/stream/scenes");
    } catch (err) {
      deletingRef.current = false;
      if (mountedRef.current) {
        setDeleting(false);
      }
      // The name typed before or during the delete, which neither its pause
      // nor the editor closing saved.
      saveUnsavedName();
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [deleteSceneAction, instanceId, engineSceneId, navigate, toast, abandonSession, saveUnsavedName]);

  const handleDuplicateScene = useCallback(async () => {
    if (!shownScene) {
      return;
    }
    try {
      const { engineSceneId: newId } = await createSceneAction({
        instanceId,
        name: `${shownScene.name} (Copy)`,
        description: shownScene.description || undefined,
        widgetsJson: JSON.stringify(shownScene.widgets),
        layoutJson: JSON.stringify({
          width: shownScene.width,
          height: shownScene.height,
          backgroundColor: shownScene.backgroundColor,
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
  }, [shownScene, createSceneAction, instanceId, navigate, toast]);

  const runDraftCommand = useCallback(
    (command: DraftCommand) => {
      const taken = client !== null && (command === "publish" ? client.publish() : client.discard());
      if (taken) {
        return;
      }
      toast({
        title: `${COMMAND_NAME[command]} wasn't sent`,
        description:
          conn === "gone"
            ? "This scene no longer exists on the scene manager."
            : "The editor hasn't loaded the scene from the scene manager yet.",
        variant: "destructive",
      });
    },
    [client, conn, toast]
  );

  const handleWidgetsChange = useCallback(
    (update: WidgetsUpdate) => mutateCanvas((canvas) => ({ ...canvas, widgets: update(canvas.widgets) })),
    [mutateCanvas]
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading scene…</div>
      </div>
    );
  }

  if (isAwaitingSync || !scene || !shownScene) {
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => navigate("/stream/scenes")} aria-label="Back to scenes">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back to scenes</TooltipContent>
        </Tooltip>
        <Input
          value={scene.name}
          onChange={(e) => updateDetails({ name: e.target.value })}
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
                onChange={(e) => updateDetails({ description: e.target.value })}
                placeholder="Optional"
                data-testid="input-scene-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Width</Label>
                <Input
                  type="number"
                  value={shownScene.width}
                  onChange={(e) => mutateCanvas((canvas) => ({ ...canvas, width: Number(e.target.value) || 0 }))}
                  disabled={canvasReadOnly}
                  data-testid="input-scene-width"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Height</Label>
                <Input
                  type="number"
                  value={shownScene.height}
                  onChange={(e) => mutateCanvas((canvas) => ({ ...canvas, height: Number(e.target.value) || 0 }))}
                  disabled={canvasReadOnly}
                  data-testid="input-scene-height"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Background</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={shownScene.backgroundColor === "transparent" ? "#000000" : shownScene.backgroundColor}
                  onChange={(e) => mutateCanvas((canvas) => ({ ...canvas, backgroundColor: e.target.value }))}
                  disabled={canvasReadOnly}
                  className="h-9 w-12 p-1 shrink-0"
                  data-testid="input-scene-bg"
                />
                <Input
                  value={shownScene.backgroundColor}
                  onChange={(e) => mutateCanvas((canvas) => ({ ...canvas, backgroundColor: e.target.value }))}
                  disabled={canvasReadOnly}
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

        {sessionMode ? (
          <>
            {live && (
              <Badge className="bg-red-600 text-white hover:bg-red-600" data-testid="badge-live">
                LIVE
              </Badge>
            )}
            <span className="text-xs text-muted-foreground" data-testid="text-scene-sync">
              {sessionStatusText(syncState, live)}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5">
                  <Switch
                    id="scene-live"
                    checked={live}
                    onCheckedChange={setLive}
                    aria-label="Edit live"
                    data-testid="switch-scene-live"
                  />
                  <Label htmlFor="scene-live" className="text-xs">
                    Live
                  </Label>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {live ? "Back to editing the draft" : "Edit what's on stream right now, without publishing"}
              </TooltipContent>
            </Tooltip>
            {/* Live edits are already on stream, so there is no draft to publish or discard. */}
            {!live && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => runDraftCommand("discard")}
                      disabled={!draftCommandsEnabled}
                      aria-label="Discard draft"
                      data-testid="button-discard-draft"
                    >
                      {pendingCommand === "discard" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Undo2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Discard draft</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => runDraftCommand("publish")}
                      disabled={!draftCommandsEnabled}
                      data-testid="button-publish-scene"
                    >
                      {pendingCommand === "publish" ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      {pendingCommand === "publish" ? "Publishing…" : "Publish"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Put the draft on stream</TooltipContent>
                </Tooltip>
              </>
            )}
          </>
        ) : (
          <>
            {needsEngineUpgrade && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground" data-testid="text-scene-engine-upgrade">
                    Upgrade your engine to edit drafts live
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  This engine's scene editor is older than this dashboard. Until it is upgraded, saving here changes
                  what's on stream.
                </TooltipContent>
              </Tooltip>
            )}
            <Button onClick={handleSave} disabled={isSaving || !isDirty} data-testid="button-save-scene">
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "Saving…" : isDirty ? "Save" : "Saved"}
            </Button>
          </>
        )}

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
      width={shownScene.width}
      height={shownScene.height}
      background={shownScene.backgroundColor}
      widgets={shownScene.widgets}
      catalog={sceneCatalog}
      renderers={configFieldRenderers}
      onChange={handleWidgetsChange}
      onSelectionChange={setSelection}
      canHide
      readOnly={canvasReadOnly}
      remoteSelections={sessionMode ? remoteSelections : undefined}
      preview={
        <LiveScenePreview
          sceneId={convexSceneId}
          width={shownScene.width}
          height={shownScene.height}
          widgets={shownScene.widgets}
          followDraft={sessionMode && !live}
        />
      }
    />
  );
}

/** The session's state in a few words: where this editor's changes are, and whether they have arrived. */
function sessionStatusText(state: SceneSyncState | null, live: boolean): string {
  if (state === null || (state.local === null && state.conn === "connecting")) {
    return "Connecting…";
  }
  switch (state.conn) {
    case "gone":
      return "This scene no longer exists";
    case "closed":
      return "Disconnected · open the scene again";
    case "unavailable":
      return "Can't reach the scene manager";
    case "connecting":
    case "offline":
      return "Reconnecting…";
    case "ready":
      break;
  }
  if (state.pendingCommand === "publish") {
    return "Publishing…";
  }
  if (state.pendingCommand === "discard") {
    return "Discarding draft…";
  }
  if (state.retrying) {
    return "Saving · retrying…";
  }
  if (state.pendingItems > 0) {
    return live ? "Saving · going to stream…" : "Saving draft…";
  }
  if (live) {
    return "Saved · on stream";
  }
  return state.hasDraft ? "Draft saved · not on stream yet" : "Up to date";
}

type FetchedScene = NonNullable<FunctionReturnType<typeof api.scenes.getByEngineSceneId>>;

function sceneOf(fetchedScene: FetchedScene): Scene {
  return {
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
  };
}

/** A colour for another editor, the same for as long as it is connected. */
function editorColor(editorId: string): string {
  let hash = 0;
  for (const char of editorId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `hsl(${hash % 360} 75% 45%)`;
}

const COMMAND_NAME: Record<DraftCommand, string> = { publish: "Publish", discard: "Discard" };
