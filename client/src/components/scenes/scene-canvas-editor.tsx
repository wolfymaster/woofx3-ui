import { api } from "@convex/_generated/api";
import type { SceneSyncState } from "@woofx3/api/scene-editor/client";
import type { Version } from "@woofx3/api/scene-editor/document";
import { type CommandResult, LocalDocumentSource, SyncDocumentSource } from "@woofx3/scene/editor";
import { type CompositionDocument, PROFILES } from "@woofx3/scene/model";
import { useQuery } from "convex/react";
import { ArrowLeft, ChevronDown, Link, MoreVertical, RefreshCw, Save, Settings, Trash2 } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import { useEngineCapabilities } from "@/engine/hooks/use-engine-capabilities";
import { useBrowserSourceUrlRequest, useRotateBrowserSourceUrlRequest } from "@/engine/hooks/use-overlays";
import {
  useCreateSceneRequest,
  useDeleteSceneRequest,
  useScene,
  useSceneWidgetCatalog,
  useUpdateSceneRequest,
} from "@/engine/hooks/use-scenes";
import type { InstanceId, SceneRecord, SceneWidgetCatalogRow } from "@/engine/types";
import { useCollapsedSidebar } from "@/hooks/use-collapsed-sidebar";
import { useCompositionEditor, useEditorKeys } from "@/hooks/use-composition-editor";
import { useSceneEditorSession } from "@/hooks/use-scene-editor-session";
import { useToast } from "@/hooks/use-toast";
import {
  type CanvasSettings,
  canvasSettingsOf,
  catalogOfRows,
  compositionOfStoredScene,
  remoteSelectionsOf,
  storedSceneJson,
} from "@/lib/scene-composition";
import type { Scene, Widget } from "@/types";
import { type DraftCommand, DraftLiveControls, type DraftLiveCopy, type DraftLiveTestIds } from "./draft-live-controls";
import { LiveScenePreview } from "./live-scene-preview";
import { WidgetLayoutCanvas } from "./widget-layout-canvas";

interface SceneCanvasEditorProps {
  instanceId: InstanceId;
  engineSceneId: string;
}

export function SceneCanvasEditor({ instanceId, engineSceneId }: SceneCanvasEditorProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  useCollapsedSidebar();

  const fetchedScene = useScene(engineSceneId);
  // undefined = loading; null = synced id not in the cache yet (webhook pending).
  const isLoading = fetchedScene === undefined;
  const isAwaitingSync = fetchedScene === null;

  const catalogRows = useSceneWidgetCatalog();
  const catalog = useMemo(() => catalogOfRows(catalogRows ?? []), [catalogRows]);

  // The scene's name and description, which are not part of the scene
  // document, and the cached scene the canvas starts from.
  const [scene, setScene] = useState<Scene | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Unsaved name or description. Local edits must survive the SCENE_UPDATED
  // webhook re-push after a save.
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
  const capabilities = useEngineCapabilities();
  const syncSupport = capabilities.support("scenes.editorSync");
  const syncSupported = syncSupport === "supported";
  const needsEngineUpgrade = !syncSupported && capabilities.support("scenes.editorSessions") === "supported";
  const [sessionMode, setSessionMode] = useState(syncSupported);
  if (syncSupported && !sessionMode) {
    setSessionMode(true);
  }
  // Until the capabilities have answered, the editor is read-only and Save is
  // off: the Save-button editor shows the published scene from the cache, and
  // a save from it on an engine with editor sync would overwrite what is on
  // stream without a publish. A failed check stays read-only for the same
  // reason, with a way to ask again.
  const editorModeKnown = sessionMode || syncSupport === "unsupported";

  // Live editing: this editor's changes go straight to what OBS shows, and
  // are copied into the draft so a later publish cannot undo them. Each open
  // editor chooses for itself, and every one starts on the draft.
  const [live, setLive] = useState(false);
  const uiVersion: Version = live ? "published" : "draft";
  const sceneId = fetchedScene?.id;

  const me = useQuery(api.users.getMe);
  const myName = me === undefined ? undefined : (me?.name ?? me?.email ?? "");
  const session = useSceneEditorSession({
    instanceId,
    engineSceneId,
    sceneId,
    enabled: sessionMode,
    editorName: myName,
    unsavedOutsideSession: sessionMode && isDirty,
  });
  const client = session.client;
  const syncState = session.state;
  const sessionLoaded = syncState?.local != null;
  const conn = syncState?.conn ?? null;
  const sessionEnded = sessionMode && (conn === "gone" || conn === "closed");
  // The canvas takes edits only once the editor knows where they go: in
  // session mode, once the session has the scene, and not after it ended.
  const canvasReadOnly = !editorModeKnown || (sessionMode && (!sessionLoaded || sessionEnded));
  const pendingCommand = syncState?.pendingCommand ?? null;
  // One Publish or Discard at a time.
  const draftCommandsEnabled =
    syncState !== null &&
    sessionLoaded &&
    !sessionEnded &&
    pendingCommand === null &&
    (syncState.hasDraft || syncState.pendingItems > 0);

  // Where the canvas's document lives. In session mode, the version being
  // edited as the sync client holds it (every pending edit applied), once the
  // client has loaded the scene. Until then, and on an engine without editor
  // sync, the cached scene in memory: there the Save button sends it whole.
  const syncSource = useMemo(
    () => (sessionMode && client !== null ? new SyncDocumentSource({ client, version: uiVersion }) : null),
    [sessionMode, client, uiVersion]
  );
  const [cacheSource, setCacheSource] = useState<LocalDocumentSource | null>(null);
  const source = syncSource !== null && sessionLoaded ? syncSource : cacheSource;
  const composition = useCompositionEditor({ source, profile: PROFILES.scene, catalog });
  const editor = composition?.editor ?? null;
  const editorState = composition?.state ?? null;
  useEditorKeys(editor);

  // The cached document last taken into the Save-button editor, or saved
  // from it: the canvas has unsaved changes while it shows anything else.
  const [savedDoc, setSavedDoc] = useState<CompositionDocument | null>(null);
  const canvasDirty = !sessionMode && editorState?.doc != null && savedDoc !== null && editorState.doc !== savedDoc;
  const unsaved = isDirty || canvasDirty;
  const adoptedFrom = useRef<FetchedScene | null>(null);

  useEffect(() => {
    if (!fetchedScene) {
      return;
    }
    if (sessionMode) {
      // Only the starting name and description, and the canvas shown until
      // the session loads, come from the cache: its later pushes would undo
      // typing.
      setScene((prev) => prev ?? sceneOf(fetchedScene));
      setCacheSource(
        (prev) => prev ?? new LocalDocumentSource(compositionOfStoredScene(sceneOf(fetchedScene)), { readOnly: true })
      );
      return;
    }
    if (unsaved || fetchedScene === adoptedFrom.current || fetchedScene.updatedAt <= echoWatermark.current) {
      return;
    }
    adoptedFrom.current = fetchedScene;
    const cached = sceneOf(fetchedScene);
    setScene(cached);
    const doc = compositionOfStoredScene(cached);
    if (cacheSource === null) {
      const made = new LocalDocumentSource(doc, { readOnly: true });
      setCacheSource(made);
      setSavedDoc(made.getDocument());
    } else {
      cacheSource.replace(doc);
      setSavedDoc(cacheSource.getDocument());
    }
  }, [fetchedScene, unsaved, sessionMode, cacheSource]);

  // The cache takes edits only in the Save-button editor, once the engine is
  // known not to sync; in session mode it is only shown until the session loads.
  useEffect(() => {
    cacheSource?.setReadOnly(sessionMode || !editorModeKnown);
  }, [cacheSource, sessionMode, editorModeKnown]);

  const shownDoc = editorState?.doc ?? null;
  const canvasSettings = useMemo(() => (shownDoc === null ? null : canvasSettingsOf(shownDoc)), [shownDoc]);

  // Who else is editing this version, and where: other editors' selections,
  // in a colour each keeps for as long as it is connected.
  const peers = editorState?.peers;
  const remoteSelections = useMemo(() => (peers === undefined ? {} : remoteSelectionsOf(peers)), [peers]);

  // The overlay follows the draft from sceneManager in session mode, and is
  // told only where widgets are being dragged; otherwise it gets the
  // editor's widgets whole.
  const followDraft = sessionMode && !live;
  const previewMessage = useMemo(
    () => (editorState === null || editor === null ? null : editor.preview.layoutMessage({ placements: !followDraft })),
    [editor, editorState, followDraft]
  );

  const updateSceneAction = useUpdateSceneRequest();
  const deleteSceneAction = useDeleteSceneRequest();
  const createSceneAction = useCreateSceneRequest();
  const getBrowserSourceUrl = useBrowserSourceUrlRequest();
  const rotateBrowserSourceUrl = useRotateBrowserSourceUrlRequest();

  const reportRefused = useCallback(
    (result: CommandResult) => {
      if (!result.ok) {
        toast({ title: "This change couldn't be made", description: result.detail, variant: "destructive" });
      }
    },
    [toast]
  );

  // The canvas's own settings are an editor change like any other: one
  // undo, and refused with the editor's reason (a size that is not a
  // positive number, a draft locked while a publish is pending).
  const editCanvasSetting = useCallback(
    <K extends keyof CanvasSettings>(key: K, value: CanvasSettings[K]) => {
      if (editor === null || canvasReadOnly) {
        return;
      }
      reportRefused(editor.canvas.patch({ [key]: value }));
    },
    [editor, canvasReadOnly, reportRefused]
  );
  // An emptied size field is a number being retyped, not a size to refuse.
  const editCanvasSize = useCallback(
    (key: "width" | "height", text: string) => {
      if (text.trim() !== "") {
        editCanvasSetting(key, Number(text));
      }
    },
    [editCanvasSetting]
  );

  const updateDetails = useCallback(
    (details: Partial<Pick<Scene, "name" | "description">>) => {
      if (!editorModeKnown) {
        return;
      }
      setScene((prev) => (prev === null ? prev : { ...prev, ...details }));
      setIsDirty(true);
    },
    [editorModeKnown]
  );

  // In session mode the name and description, which are not part of the
  // document, save themselves a moment after typing stops, or at once when
  // the editor closes first.
  const sceneName = scene?.name;
  const sceneDescription = scene?.description;
  const saveNameAndDescription = useCallback(
    (name: string, description: string | undefined) => {
      updateSceneAction(engineSceneId, { name, description }).catch((err) =>
        toast({
          title: "Couldn't save the scene's name",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        })
      );
    },
    [updateSceneAction, engineSceneId, toast]
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

  const handleCopyBrowserSource = useCallback(async () => {
    if (!sceneId) {
      return;
    }
    try {
      const browserSourceUrl = await getBrowserSourceUrl(sceneId);
      await navigator.clipboard.writeText(browserSourceUrl);
      toast({ title: "Browser source URL copied", description: browserSourceUrl });
    } catch (err) {
      toast({
        title: "Couldn't copy URL",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [sceneId, getBrowserSourceUrl, toast]);

  const handleRotateBrowserSource = useCallback(async () => {
    if (!sceneId) {
      return;
    }
    try {
      await navigator.clipboard.writeText(await rotateBrowserSourceUrl(sceneId));
      toast({ title: "Browser source URL rotated", description: "Old URLs revoked. New URL copied." });
    } catch (err) {
      toast({
        title: "Couldn't rotate URL",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [sceneId, rotateBrowserSourceUrl, toast]);

  const handleSave = useCallback(async () => {
    if (!scene || !shownDoc || sessionMode || !editorModeKnown) {
      return;
    }
    setIsSaving(true);
    // Everything this query serves until the echo lands describes the scene as
    // it was before this save.
    echoWatermark.current = fetchedScene?.updatedAt ?? echoWatermark.current;
    try {
      await updateSceneAction(engineSceneId, {
        name: scene.name,
        description: scene.description,
        ...storedSceneJson(shownDoc),
      });
      setIsDirty(false);
      setSavedDoc(shownDoc);
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
  }, [scene, shownDoc, sessionMode, editorModeKnown, engineSceneId, updateSceneAction, toast, fetchedScene?.updatedAt]);

  const abandonSession = session.abandon;
  const handleDeleteScene = useCallback(async () => {
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteSceneAction(engineSceneId);
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
  }, [deleteSceneAction, engineSceneId, navigate, toast, abandonSession, saveUnsavedName]);

  const handleDuplicateScene = useCallback(async () => {
    if (!scene || !shownDoc) {
      return;
    }
    try {
      const { engineSceneId: newId } = await createSceneAction({
        name: `${scene.name} (Copy)`,
        description: scene.description || undefined,
        ...storedSceneJson(shownDoc),
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
  }, [scene, shownDoc, createSceneAction, navigate, toast]);

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

  if (!editor || !editorState || !canvasSettings) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading scene…</div>
      </div>
    );
  }

  const notice = sessionMode ? sessionNotice(syncState) : null;
  const header = (
    <div className="h-14 border-b border-border bg-background flex items-center justify-between gap-4 px-4 shrink-0">
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
          disabled={!editorModeKnown}
          className="font-semibold border-none bg-transparent focus-visible:ring-0 w-56"
          data-testid="input-scene-name"
        />
        {/* On the left so its changing length never moves the controls on the right. */}
        {notice !== null && (
          <span className="text-xs text-muted-foreground truncate" data-testid="text-scene-sync">
            {notice}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Browser source: copying the URL is the common action, rotating it the rare one. */}
        <div className="flex items-center">
          <Button
            variant="outline"
            className="rounded-r-none"
            onClick={handleCopyBrowserSource}
            disabled={!sceneId}
            data-testid="button-copy-browser-source"
          >
            <Link className="h-4 w-4 mr-2" />
            Copy OBS URL
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="rounded-l-none border-l-0"
                disabled={!sceneId}
                aria-label="More browser source options"
                data-testid="button-browser-source-menu"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleRotateBrowserSource} data-testid="menu-rotate-browser-source">
                <RefreshCw className="h-4 w-4 mr-2" />
                Rotate URL (revoke old)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {sessionMode ? (
          <DraftLiveControls
            live={live}
            onLiveChange={setLive}
            commandsEnabled={draftCommandsEnabled}
            pendingCommand={pendingCommand}
            onCommand={runDraftCommand}
            hasDraft={syncState?.hasDraft ?? false}
            unsaved={hasUnsavedEdits(syncState, live)}
            copy={SCENE_DRAFT_COPY}
            testIds={SCENE_DRAFT_TEST_IDS}
          />
        ) : (
          <>
            {syncSupport === "checking" && (
              <span className="text-xs text-muted-foreground" data-testid="text-scene-checking-engine">
                Checking the engine…
              </span>
            )}
            {syncSupport === "unknown" && (
              <>
                <span className="text-xs text-muted-foreground" data-testid="text-scene-engine-check-failed">
                  Couldn't check the engine's features
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={capabilities.refresh}
                  data-testid="button-retry-engine-check"
                >
                  Retry
                </Button>
              </>
            )}
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
            <Button
              onClick={handleSave}
              disabled={!editorModeKnown || isSaving || !unsaved}
              data-testid="button-save-scene"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "Saving…" : unsaved ? "Save" : "Saved"}
            </Button>
          </>
        )}

        <Separator orientation="vertical" className="h-6" />

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
                disabled={!editorModeKnown}
                placeholder="Optional"
                data-testid="input-scene-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Width</Label>
                <Input
                  type="number"
                  value={canvasSettings.width}
                  onChange={(e) => editCanvasSize("width", e.target.value)}
                  disabled={canvasReadOnly}
                  data-testid="input-scene-width"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Height</Label>
                <Input
                  type="number"
                  value={canvasSettings.height}
                  onChange={(e) => editCanvasSize("height", e.target.value)}
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
                  value={canvasSettings.backgroundColor === "transparent" ? "#000000" : canvasSettings.backgroundColor}
                  onChange={(e) => editCanvasSetting("backgroundColor", e.target.value)}
                  disabled={canvasReadOnly}
                  className="h-9 w-12 p-1 shrink-0"
                  data-testid="input-scene-bg"
                />
                <Input
                  value={canvasSettings.backgroundColor}
                  onChange={(e) => editCanvasSetting("backgroundColor", e.target.value)}
                  disabled={canvasReadOnly}
                  placeholder="transparent"
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

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
      editor={editor}
      state={editorState}
      catalog={catalogRows ?? NO_ROWS}
      renderers={configFieldRenderers}
      readOnly={canvasReadOnly}
      remoteSelections={sessionMode ? remoteSelections : undefined}
      onRefused={reportRefused}
      preview={
        <LiveScenePreview
          sceneId={sceneId}
          width={canvasSettings.width}
          height={canvasSettings.height}
          layoutMessage={previewMessage}
          followDraft={followDraft}
        />
      }
    />
  );
}

/**
 * The session's state in a few words: where this editor's changes are, and whether they
 * have arrived. `noun` is what the session edits, a scene or an alert.
 */
export function sessionStatusText(state: SceneSyncState | null, live: boolean, noun = "scene"): string {
  if (state === null || (state.local === null && state.conn === "connecting")) {
    return "Connecting…";
  }
  switch (state.conn) {
    case "gone":
      return `This ${noun} no longer exists`;
    case "closed":
      return `Disconnected · open the ${noun} again`;
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

/**
 * What the header says about the session beyond the live and saved indicators: why it
 * cannot take edits, or the command it is running. Null while it is simply connected.
 */
export function sessionNotice(state: SceneSyncState | null, noun = "scene"): string | null {
  if (state === null || state.conn !== "ready" || state.pendingCommand !== null) {
    return sessionStatusText(state, false, noun);
  }
  return null;
}

/**
 * Edits not yet where this editor's mode puts them: still on their way to the scene
 * manager, or, while not live updating, waiting in a draft that has not been published.
 */
export function hasUnsavedEdits(state: SceneSyncState | null, live: boolean): boolean {
  if (state === null) {
    return false;
  }
  return state.pendingItems > 0 || state.retrying || (!live && state.hasDraft);
}

type FetchedScene = SceneRecord;

function sceneOf(fetchedScene: FetchedScene): Scene {
  return {
    id: fetchedScene.id,
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

const COMMAND_NAME: Record<DraftCommand, string> = { publish: "Publish", discard: "Discard" };

const SCENE_DRAFT_COPY: DraftLiveCopy = {
  draft: "Edits go to a draft that reaches OBS when you publish it",
  live: "Edits go straight to what's on stream, without publishing",
  liveDisabled: "Live edits are already on stream",
  publish: "Put the draft on stream",
  discardTitle: "Discard your draft of this scene?",
  discardDescription: "Every change since the last publish is thrown away. What's on stream stays as it is.",
};

const SCENE_DRAFT_TEST_IDS: DraftLiveTestIds = {
  live: "menu-scene-live-update",
  discard: "button-discard-draft",
  confirmDiscard: "button-confirm-discard-draft",
  publish: "button-publish-scene",
};

const NO_ROWS: SceneWidgetCatalogRow[] = [];
