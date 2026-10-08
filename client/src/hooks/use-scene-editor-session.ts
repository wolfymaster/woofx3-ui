import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneDocument, SceneVersion } from "@/lib/scene-document";
import { type EditorPresence, type EditorState, SceneEditorClient } from "@/lib/scene-editor-client";

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
   * while they are, as it does for the session's own edits.
   */
  unsavedOutsideSession: boolean;
}

export interface SceneEditorSessionHandle {
  state: EditorState;
  /**
   * The editor changed its canvas, read from `version`; sent within a fifth of
   * a second. A canvas read from the version the session is not editing is dropped.
   */
  edit: (doc: SceneDocument, version: SceneVersion) => void;
  publish: () => void;
  discard: () => void;
  /** Tell the scene's other editors who this is and what it has selected. */
  setPresence: (presence: EditorPresence) => void;
  /** Close the session at once, sending nothing more: for a scene that was deleted. */
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
}: UseSceneEditorSessionArgs): SceneEditorSessionHandle {
  const getSession = useAction(api.sceneActions.getSceneEditorSession);
  const getPreviewUrl = useAction(api.browserSource.getOrCreatePreviewUrl);
  const [state, setState] = useState<EditorState>(IDLE);
  const clientRef = useRef<SceneEditorClient | null>(null);
  const versionRef = useRef(version);
  versionRef.current = version;
  const unsavedOutsideSessionRef = useRef(unsavedOutsideSession);
  unsavedOutsideSessionRef.current = unsavedOutsideSession;

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
      version: versionRef.current,
    });
    clientRef.current = client;
    client.start();
    return () => {
      client.stop();
      clientRef.current = null;
      setState(IDLE);
    };
  }, [enabled, sceneId, instanceId, engineSceneId, getSession, getPreviewUrl]);

  useEffect(() => {
    clientRef.current?.setVersion(version);
  }, [version]);

  // Closing the tab skips React's cleanup: send what is waiting, and ask the
  // browser to hold the page while edits are still on their way.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const client = clientRef.current;
      client?.flush();
      if (client?.hasUnconfirmed() || unsavedOutsideSessionRef.current) {
        event.preventDefault();
        // Browsers that predate preventDefault here prompt only for a non-empty returnValue.
        event.returnValue = "Changes to this scene are still being saved.";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled]);

  const edit = useCallback(
    (doc: SceneDocument, docVersion: SceneVersion) => clientRef.current?.edit(doc, docVersion),
    []
  );
  const publish = useCallback(() => clientRef.current?.publish(), []);
  const discard = useCallback(() => clientRef.current?.discard(), []);
  const setPresence = useCallback((presence: EditorPresence) => clientRef.current?.setPresence(presence), []);
  const abandon = useCallback(() => clientRef.current?.abandon(), []);

  return { state, edit, publish, discard, setPresence, abandon };
}
