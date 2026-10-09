import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
import type { SceneVersion } from "@/lib/scene-document";
import { canvasOfDocument, documentOfCanvas } from "@/lib/scene-document-widgets";
import type { DraftCommand, DroppedWork, EditorState } from "@/lib/scene-editor-client";
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

  // An engine with editor sessions edits the scene live through sceneManager:
  // every change is sent as it is made and saved for you, into a draft OBS
  // does not show until it is published. Older engines save with the button.
  // Once seen, the capability holds for as long as the editor is open: the
  // capabilities reload after an engine reconnect, and dropping to the
  // Save-button editor meanwhile would swap the published scene from the
  // cache in for the draft on the canvas. The editor is keyed by instance
  // (see pages/scenes.tsx), so another instance starts over and has to show
  // the capability itself.
  const sessionSupported = useEngineCapabilities(instanceId).support("scenes.editorSessions") === "supported";
  const [sessionMode, setSessionMode] = useState(sessionSupported);
  if (sessionSupported && !sessionMode) {
    setSessionMode(true);
  }

  // Live editing: this editor's changes go straight to what OBS shows, and
  // are copied into the draft so a later publish cannot undo them. Each open
  // editor chooses for itself, and every one starts on the draft.
  const [live, setLive] = useState(false);
  const convexSceneId = fetchedScene?._id as Id<"scenes"> | undefined;
  const handleDropped = useCallback(
    (dropped: DroppedWork, sceneName: string | undefined) => {
      toast({ ...droppedWorkMessage(dropped, sceneName), variant: "destructive" });
    },
    [toast]
  );
  const session = useSceneEditorSession({
    instanceId,
    engineSceneId,
    sceneId: convexSceneId,
    enabled: sessionMode,
    version: live ? "published" : "draft",
    unsavedOutsideSession: sessionMode && isDirty,
    sceneName: scene?.name,
    onDropped: handleDropped,
  });
  const sessionDoc = session.state.doc;
  const sessionVersion = session.state.version;
  // From a Publish or Discard until the engine answers it, the draft is
  // read-only: the session drops draft edits meanwhile, so the canvas takes
  // none. Live editing goes on, as it edits the published scene. The command
  // may be another session's, left draining by an editor of this scene that
  // closed: this session would take the edits, so the canvas refuses them.
  const pendingCommand = session.state.command;
  const draftLocked = sessionMode && !live && pendingCommand !== null;
  // Read by mutateScene, and set at the click too, before the render that shows the command.
  const pendingCommandRef = useRef(pendingCommand);
  pendingCommandRef.current = pendingCommand;
  const sceneGone = sessionMode && session.state.status === "gone";
  // A session that cannot carry a Publish or Discard: the engine would not open one, or the scene is gone.
  const sessionDown = sessionMode && (session.state.status === "unavailable" || sceneGone);

  // Who else is editing, and where: other editors' selections, in a colour
  // each keeps for as long as it is connected.
  const me = useQuery(api.users.getMe);
  const myName = me?.name ?? me?.email ?? "";
  const [selection, setSelection] = useState<string | null>(null);
  const setPresence = session.setPresence;
  const ready = session.state.status === "ready";
  useEffect(() => {
    if (sessionMode && ready) {
      setPresence({ name: myName, selection });
    }
  }, [sessionMode, ready, myName, selection, setPresence]);
  const others = session.state.others;
  const remoteSelections = useMemo(() => {
    const byWidget: Record<string, { name: string; color: string }[]> = {};
    for (const [editorId, presence] of Object.entries(others)) {
      if (presence.selection) {
        const editors = byWidget[presence.selection] ?? [];
        editors.push({ name: presence.name, color: editorColor(editorId) });
        byWidget[presence.selection] = editors;
      }
    }
    return byWidget;
  }, [others]);
  // Read by mutateScene, which sends each edit as it is made.
  const sceneRef = useRef<Scene | null>(null);
  sceneRef.current = scene;
  const sessionDocRef = useRef(sessionDoc);
  sessionDocRef.current = sessionDoc;
  // The version the canvas was last read from, set together with sceneRef so
  // an edit is always sent as an edit of the version its canvas shows.
  const canvasVersionRef = useRef<SceneVersion | null>(null);

  useEffect(() => {
    if (sessionMode) {
      return;
    }
    if (fetchedScene && !isDirty && fetchedScene.updatedAt > echoWatermark.current) {
      setScene(sceneOf(fetchedScene));
    }
  }, [fetchedScene, isDirty, sessionMode]);

  // In session mode the canvas is the session's document, kept current as
  // other editors' changes arrive; name and description are the scene's own.
  // Only the starting name and description come from it: its later pushes are ignored.
  const fetchedSceneRef = useRef(fetchedScene);
  fetchedSceneRef.current = fetchedScene;
  const sceneLoaded = fetchedScene !== undefined && fetchedScene !== null;
  useEffect(() => {
    if (!sessionDoc) {
      // No session document: the session has no snapshot of the version it
      // edits yet (it is new, or was just made again), and the canvas shown
      // is not one it has read. Edits to it are not sent until the snapshot
      // replaces it. A reconnect keeps the document, so this is not that.
      canvasVersionRef.current = null;
    }
    const fetched = fetchedSceneRef.current;
    if (!sessionMode || !sessionDoc || !sceneLoaded || !fetched) {
      return;
    }
    const next = { ...(sceneRef.current ?? sceneOf(fetched)), ...canvasOfDocument(sessionDoc) };
    sceneRef.current = next;
    canvasVersionRef.current = sessionVersion;
    setScene(next);
  }, [sessionMode, sessionDoc, sessionVersion, sceneLoaded]);

  const updateSceneAction = useAction(api.sceneActions.updateScene);
  const deleteSceneAction = useAction(api.sceneActions.deleteScene);
  const createSceneAction = useAction(api.sceneActions.createScene);
  const getOrCreateBrowserSourceKey = useAction(api.browserSource.getOrCreateBrowserSourceKey);
  const rotateBrowserSourceKey = useAction(api.browserSource.rotateBrowserSourceKey);

  const sessionEdit = session.edit;
  const mutateScene = useCallback(
    (updater: (prev: Scene) => Scene) => {
      const prev = sceneRef.current;
      if (!prev) {
        return;
      }
      let next = updater(prev);
      if (sessionMode && pendingCommandRef.current !== null && canvasVersionRef.current === "draft") {
        // The draft is locked (see `draftLocked`); the name and description are not part of it.
        next = { ...prev, name: next.name, description: next.description };
        if (next.name === prev.name && next.description === prev.description) {
          return;
        }
      }
      if (sessionMode) {
        // Straight to the session, never from an effect on the scene: a
        // render that follows another editor's change must not send the
        // canvas it replaced. A canvas not yet read from the session (the
        // cached scene shown while it connects) is never sent. One the
        // session does not take shows the session's document instead, so
        // the canvas never keeps an edit that went nowhere.
        const canvasVersion = canvasVersionRef.current;
        const sessionDoc = sessionDocRef.current;
        if (canvasVersion !== null && !sessionEdit(documentOfCanvas(next, sessionDoc), canvasVersion) && sessionDoc) {
          next = { ...next, ...canvasOfDocument(sessionDoc) };
        }
      }
      sceneRef.current = next;
      setScene(next);
      if (sessionMode) {
        if (next.name !== prev.name || next.description !== prev.description) {
          setIsDirty(true);
        }
      } else {
        setIsDirty(true);
      }
    },
    [sessionMode, sessionEdit]
  );

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

  const sessionPublish = session.publish;
  const sessionDiscard = session.discard;
  const sessionStatus = session.state.status;
  const runDraftCommand = useCallback(
    (command: DraftCommand) => {
      // Locks the canvas now rather than at the next render: an edit made in
      // between (a drag still moving) would be dropped by the session.
      const previous = pendingCommandRef.current;
      pendingCommandRef.current = command;
      const taken = command === "publish" ? sessionPublish() : sessionDiscard();
      if (taken) {
        return;
      }
      pendingCommandRef.current = previous;
      toast({
        title: `${COMMAND_LABEL[command].name} wasn't sent`,
        description:
          sessionStatus === "gone"
            ? "This scene no longer exists on the scene manager."
            : "The editor isn't connected to the scene manager.",
        variant: "destructive",
      });
    },
    [sessionPublish, sessionDiscard, sessionStatus, toast]
  );

  const handleWidgetsChange = useCallback(
    (update: WidgetsUpdate) => mutateScene((prev) => ({ ...prev, widgets: update(prev.widgets) })),
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

        {sessionMode ? (
          <>
            {live && (
              <Badge className="bg-red-600 text-white hover:bg-red-600" data-testid="badge-live">
                LIVE
              </Badge>
            )}
            <span className="text-xs text-muted-foreground" data-testid="text-scene-sync">
              {sessionStatusText(session.state, live)}
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
                      disabled={!session.state.hasDraft || pendingCommand !== null || sessionDown}
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
                      disabled={!session.state.hasDraft || pendingCommand !== null || sessionDown}
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
          <Button onClick={handleSave} disabled={isSaving || !isDirty} data-testid="button-save-scene">
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving…" : isDirty ? "Save" : "Saved"}
          </Button>
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
      width={scene.width}
      height={scene.height}
      background={scene.backgroundColor}
      widgets={scene.widgets}
      catalog={sceneCatalog}
      renderers={configFieldRenderers}
      onChange={handleWidgetsChange}
      onSelectionChange={setSelection}
      canHide
      readOnly={draftLocked || sceneGone}
      remoteSelections={sessionMode ? remoteSelections : undefined}
      preview={
        <LiveScenePreview
          sceneId={convexSceneId}
          width={scene.width}
          height={scene.height}
          widgets={scene.widgets}
          followDraft={sessionMode && !live}
        />
      }
    />
  );
}

/** The session's state in a few words: where this editor's changes are, and whether they have arrived. */
function sessionStatusText(state: EditorState, live: boolean): string {
  if (state.status === "reconnecting") {
    return "Reconnecting…";
  }
  if (state.status === "unavailable") {
    return "Can't reach the scene manager";
  }
  if (state.status === "gone") {
    return "This scene no longer exists";
  }
  if (!live && state.command === "publish") {
    return "Publishing…";
  }
  if (!live && state.command === "discard") {
    return "Discarding draft…";
  }
  if (state.unsaved) {
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

const COMMAND_LABEL: Record<DraftCommand, { name: string; verb: string }> = {
  publish: { name: "Publish", verb: "publish" },
  discard: { name: "Discard", verb: "discard" },
};

/** What a toast says about work the editor session gave up on, naming the scene: it may no longer be open. */
function droppedWorkMessage(
  dropped: DroppedWork,
  sceneName: string | undefined
): { title: string; description: string } {
  const scene = sceneName ? `"${sceneName}"` : "the scene";
  if (dropped.reason === "gone") {
    const command = dropped.command === null ? null : COMMAND_LABEL[dropped.command].name;
    const lost = [dropped.edits ? "your last changes weren't saved" : null, command ? `${command} wasn't sent` : null]
      .filter((part) => part !== null)
      .join(", and ");
    return {
      title: `${scene.charAt(0).toUpperCase()}${scene.slice(1)} no longer exists`,
      description: `The scene manager doesn't have it any more, so ${lost}.`,
    };
  }
  if (dropped.reason !== "undelivered") {
    const { name, verb } = COMMAND_LABEL[dropped.command];
    if (dropped.reason === "failed") {
      return {
        title: `${name} failed`,
        description: `The scene manager couldn't ${verb} the draft of ${scene}. Check the scene and try again.`,
      };
    }
    if (dropped.reason === "refused") {
      return {
        title: `${name} didn't go through`,
        description: `The scene manager refused a change to the draft of ${scene} made before it, so it wasn't sent. Check the scene and try again.`,
      };
    }
    return {
      title: `${name} may not have gone through`,
      description: `The connection dropped before the scene manager answered. Check ${scene}, and ${verb} again if it didn't.`,
    };
  }
  const closed = `The editor for ${scene} closed before the scene manager confirmed them. Open the scene to check it.`;
  const command = dropped.command === null ? null : COMMAND_LABEL[dropped.command].name;
  if (command === null) {
    return { title: "Your last changes may not have been saved", description: closed };
  }
  if (dropped.edits) {
    return { title: `Your last changes may not have been saved, and ${command} wasn't sent`, description: closed };
  }
  return {
    title: `${command} wasn't sent`,
    description: `The editor for ${scene} closed before it could reach the scene manager. Open the scene and try again.`,
  };
}
