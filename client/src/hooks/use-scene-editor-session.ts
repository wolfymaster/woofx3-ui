import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SceneDocument, SceneVersion } from "@/lib/scene-document";
import { type DroppedWork, type EditorPresence, type EditorState, SceneEditorClient } from "@/lib/scene-editor-client";
import { sceneEditorSessions, sceneKeyOf } from "@/lib/scene-editor-sessions";

interface UseSceneEditorSessionArgs {
  instanceId: Id<"instances">;
  engineSceneId: string;
  /** The Convex scene, whose preview URL names sceneManager's public origin. */
  sceneId: Id<"scenes"> | undefined;
  /** False for an engine without `scenes.editorSessions`: the hook stays idle. */
  enabled: boolean;
  /** The version edits go to: the draft, or the published scene (live). */
  version: SceneVersion;
  /**
   * Whether the editor holds changes the session does not carry (the scene's
   * name and description) that are not saved yet; closing the tab asks first
   * while they are, as it does for the session's own edits, whether or not a
   * session is open.
   */
  unsavedOutsideSession: boolean;
  /** The scene's name as the editor shows it, handed to `onDropped`. */
  sceneName: string | undefined;
  /**
   * A Publish or Discard, or edits, that did not go through or may not have
   * (see `DroppedWork`), with the scene's name as it last was: called after
   * the editor unmounts too, while the session drains, when another scene
   * may be open.
   */
  onDropped: (dropped: DroppedWork, sceneName: string | undefined) => void;
}

export interface SceneEditorSessionHandle {
  /**
   * The session's state. `command` is also a Publish or Discard that another
   * session of the scene waits on (one left draining by an editor that
   * closed): the draft is locked until it is answered either way.
   */
  state: EditorState;
  /**
   * The editor changed its canvas, read from `version`; sent within a fifth of
   * a second. A canvas read from the version the session is not editing is
   * dropped, as is a draft canvas while a Publish or Discard waits (`state.command`),
   * and every canvas once the scene is gone. Returns whether it was taken.
   */
  edit: (doc: SceneDocument, version: SceneVersion) => boolean;
  /**
   * Returns whether it was taken: not while a Publish or Discard already
   * waits, nor without a session to carry it (no session, the engine would
   * not open one, or the scene is gone).
   */
  publish: () => boolean;
  /** As `publish`. */
  discard: () => boolean;
  /** Tell the scene's other editors who this is and what it has selected. */
  setPresence: (presence: EditorPresence) => void;
  /**
   * Close this scene's sessions at once, sending nothing more: for a scene
   * that was deleted. Reaches a session still draining after its editor
   * closed, so it is safe to call after the editor unmounts.
   */
  abandon: () => void;
}

const IDLE: EditorState = {
  status: "connecting",
  version: "draft",
  others: {},
  doc: null,
  meta: {},
  hasDraft: false,
  unsaved: false,
  command: null,
};

/**
 * The scene editor's connection to sceneManager: a short-lived token from the
 * engine (through Convex) opens sceneManager's editor socket, at the origin the
 * scene's preview overlay is served from. See `SceneEditorClient`.
 *
 * A client made again (the scene or the engine's capabilities reloaded) starts
 * on the version the editor is on, so it never edits the draft under a LIVE
 * badge or the published scene without one.
 */
export function useSceneEditorSession({
  instanceId,
  engineSceneId,
  sceneId,
  enabled,
  version,
  unsavedOutsideSession,
  sceneName,
  onDropped,
}: UseSceneEditorSessionArgs): SceneEditorSessionHandle {
  const getSession = useAction(api.sceneActions.getSceneEditorSession);
  const getPreviewUrl = useAction(api.browserSource.getOrCreatePreviewUrl);
  const [state, setState] = useState<EditorState>(IDLE);
  const clientRef = useRef<SceneEditorClient | null>(null);
  const versionRef = useRef(version);
  versionRef.current = version;
  const unsavedOutsideSessionRef = useRef(unsavedOutsideSession);
  unsavedOutsideSessionRef.current = unsavedOutsideSession;
  const onDroppedRef = useRef(onDropped);
  onDroppedRef.current = onDropped;
  const sceneNameRef = useRef(sceneName);
  sceneNameRef.current = sceneName;

  const sceneKey = sceneKeyOf(instanceId, engineSceneId);
  const sharedCommand = useSyncExternalStore(sceneEditorSessions.subscribe, () =>
    sceneEditorSessions.commandOf(sceneKey)
  );

  // The editor saves its own unsaved changes as it unmounts.
  useEffect(() => sceneEditorSessions.registerUnsavedCheck(() => unsavedOutsideSessionRef.current), []);

  useEffect(() => {
    if (!enabled || !sceneId) {
      return;
    }
    const client = new SceneEditorClient({
      open: async () => {
        const [session, previewUrl] = await Promise.all([
          getSession({ instanceId, engineSceneId }),
          getPreviewUrl({ sceneId }),
        ]);
        if (!session || !previewUrl) {
          return null;
        }
        const url = new URL(session.path, new URL(previewUrl).origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("token", session.token);
        return url.toString();
      },
      onChange: setState,
      onClose: () => unregister(),
      onDropped: (dropped) => onDroppedRef.current(dropped, sceneNameRef.current),
      onCommandChange: () => sceneEditorSessions.commandChanged(),
      version: versionRef.current,
    });
    const unregister = sceneEditorSessions.register(client, sceneKeyOf(instanceId, engineSceneId));
    clientRef.current = client;
    client.start();
    return () => {
      // A session with nothing to deliver closes now, and its onClose
      // unregisters it; one that drains stays registered until it closes.
      client.stop();
      clientRef.current = null;
      setState(IDLE);
    };
  }, [enabled, sceneId, instanceId, engineSceneId, getSession, getPreviewUrl]);

  useEffect(() => {
    clientRef.current?.setVersion(version);
  }, [version]);

  const edit = useCallback(
    (doc: SceneDocument, docVersion: SceneVersion) => clientRef.current?.edit(doc, docVersion) ?? false,
    []
  );
  // Another session's command locks the draft too, though this client does not know of it.
  const publish = useCallback(
    () => sceneEditorSessions.commandOf(sceneKey) === null && (clientRef.current?.publish() ?? false),
    [sceneKey]
  );
  const discard = useCallback(
    () => sceneEditorSessions.commandOf(sceneKey) === null && (clientRef.current?.discard() ?? false),
    [sceneKey]
  );
  const setPresence = useCallback((presence: EditorPresence) => clientRef.current?.setPresence(presence), []);
  const abandon = useCallback(() => sceneEditorSessions.abandonScene(sceneKey), [sceneKey]);

  const sharedState = useMemo(
    () => (state.command === null && sharedCommand !== null ? { ...state, command: sharedCommand } : state),
    [state, sharedCommand]
  );

  return { state: sharedState, edit, publish, discard, setPresence, abandon };
}
