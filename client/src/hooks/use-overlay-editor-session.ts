import type { SceneSyncState } from "@woofx3/api/scene-editor/client";
import type { Version } from "@woofx3/api/scene-editor/document";
import { type CatalogWidget, LocalDocumentSource } from "@woofx3/scene/editor";
import type { CompositionDocument, CompositionProfile } from "@woofx3/scene/model";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DraftCommand } from "@/components/scenes/draft-live-controls";
import type { InstanceId, SceneId } from "@/engine/types";
import { type CompositionEditorHandle, useCompositionEditor, useEditorKeys } from "@/hooks/use-composition-editor";
import { type SceneEditorSession, useSceneEditorSession } from "@/hooks/use-scene-editor-session";
import { useToast } from "@/hooks/use-toast";
import { socketDraftSource } from "@/lib/editor-document-source";
import { useViewerName } from "@/lib/viewer-name";

interface UseOverlayEditorSessionArgs {
  instanceId: InstanceId;
  engineSceneId: string;
  /** What the session edits, for words shown to the user. */
  noun: "scene" | "alert";
  profile: CompositionProfile;
  catalog: readonly CatalogWidget[];
  /** The published document from the cache, shown read-only until the session has loaded; null until it is known. */
  cacheDocument: CompositionDocument | null;
  /** The Convex scene, whose preview URL names sceneManager's public origin. Scenes only. */
  sceneId?: SceneId;
  /** sceneManager's public URL for a composition with no preview page. Alerts only. */
  socketOrigin?: () => Promise<string | null>;
  /** Unsaved changes the session does not carry (a scene's name); closing the tab asks while there are. Scenes only. */
  unsavedOutsideSession?: boolean;
}

export interface OverlayEditorSession {
  session: SceneEditorSession;
  composition: CompositionEditorHandle | null;
  /** Whether this editor's changes go straight to what is shown, not to a draft. */
  live: boolean;
  setLive: (live: boolean) => void;
  uiVersion: Version;
  syncState: SceneSyncState | null;
  conn: SceneSyncState["conn"] | null;
  sessionLoaded: boolean;
  sessionEnded: boolean;
  pendingCommand: SceneSyncState["pendingCommand"] | null;
  /** Publish and Discard may be pressed: one at a time, on a loaded session that has something to send. */
  draftCommandsEnabled: boolean;
  runDraftCommand: (command: DraftCommand) => void;
}

/**
 * The chain both saved editors (a scene, a library alert) share: sync session,
 * its state flags, the document source, and the composition editor over it.
 *
 * Every open editor chooses for itself between the draft (the default) and
 * live editing. A live edit goes straight to what is shown, and the scene
 * manager copies it into the draft too, so a later publish cannot undo it.
 *
 * The synced document is used once the session has loaded and stays in use after
 * it ends, read-only by the source's own reason; the cached document stands in
 * only before the first load.
 */
export function useOverlayEditorSession({
  instanceId,
  engineSceneId,
  noun,
  profile,
  catalog,
  cacheDocument,
  sceneId,
  socketOrigin,
  unsavedOutsideSession = false,
}: UseOverlayEditorSessionArgs): OverlayEditorSession {
  const { toast } = useToast();
  const editorName = useViewerName();
  const [live, setLive] = useState(false);
  const uiVersion: Version = live ? "published" : "draft";

  const session = useSceneEditorSession({
    instanceId,
    engineSceneId,
    sceneId,
    publicUrl: socketOrigin,
    editorName,
    unsavedOutsideSession,
  });
  const client = session.client;
  const syncState = session.state;
  const sessionLoaded = syncState?.local != null;
  const conn = syncState?.conn ?? null;
  const sessionEnded = conn === "gone" || conn === "closed";
  const pendingCommand = syncState?.pendingCommand ?? null;
  const draftCommandsEnabled =
    syncState !== null &&
    sessionLoaded &&
    !sessionEnded &&
    pendingCommand === null &&
    (syncState.hasDraft || syncState.pendingItems > 0);

  const draft = useMemo(() => (client !== null ? socketDraftSource(client, uiVersion) : null), [client, uiVersion]);
  // Made once: later cache pushes would undo what the user has typed.
  const [cacheSource, setCacheSource] = useState<LocalDocumentSource | null>(null);
  useEffect(() => {
    if (cacheDocument !== null) {
      setCacheSource((prev) => prev ?? new LocalDocumentSource(cacheDocument, { readOnly: true }));
    }
  }, [cacheDocument]);
  const source = draft !== null && sessionLoaded ? draft.source : cacheSource;
  const composition = useCompositionEditor({ source, profile, catalog });
  useEditorKeys(composition?.editor ?? null);

  const runDraftCommand = useCallback(
    (command: DraftCommand) => {
      const taken = draft !== null && (command === "publish" ? draft.publish() : draft.discard());
      if (taken) {
        return;
      }
      toast({
        title: `${command === "publish" ? "Publish" : "Discard"} wasn't sent`,
        description:
          conn === "gone"
            ? `This ${noun} no longer exists on the scene manager.`
            : `The editor hasn't loaded the ${noun} from the scene manager yet.`,
        variant: "destructive",
      });
    },
    [draft, conn, noun, toast]
  );

  return {
    session,
    composition,
    live,
    setLive,
    uiVersion,
    syncState,
    conn,
    sessionLoaded,
    sessionEnded,
    pendingCommand,
    draftCommandsEnabled,
    runDraftCommand,
  };
}
