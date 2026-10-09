import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  state: EditorState;
  /**
   * The editor changed its canvas, read from `version`; sent within a fifth of
   * a second. A canvas read from the version the session is not editing is
   * dropped, as is a draft canvas while a Publish or Discard waits (`state.command`).
   */
  edit: (doc: SceneDocument, version: SceneVersion) => void;
  /** Does nothing while a Publish or Discard already waits. */
  publish: () => void;
  /** Does nothing while a Publish or Discard already waits. */
  discard: () => void;
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
    (doc: SceneDocument, docVersion: SceneVersion) => clientRef.current?.edit(doc, docVersion),
    []
  );
  const publish = useCallback(() => clientRef.current?.publish(), []);
  const discard = useCallback(() => clientRef.current?.discard(), []);
  const setPresence = useCallback((presence: EditorPresence) => clientRef.current?.setPresence(presence), []);
  const abandon = useCallback(
    () => sceneEditorSessions.abandonScene(sceneKeyOf(instanceId, engineSceneId)),
    [instanceId, engineSceneId]
  );

  return { state, edit, publish, discard, setPresence, abandon };
}
