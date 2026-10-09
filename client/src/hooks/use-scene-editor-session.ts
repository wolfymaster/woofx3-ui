import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneDocument, SceneVersion } from "@/lib/scene-document";
import {
  type DraftCommand,
  type DraftCommandDropReason,
  type EditorPresence,
  type EditorState,
  SceneEditorClient,
} from "@/lib/scene-editor-client";

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
  /**
   * A Publish or Discard will never be sent: the engine refused an edit to the
   * draft made before it, or the session closed first. Called after the editor
   * unmounts too, while the session drains.
   */
  onDraftCommandsDropped: (commands: DraftCommand[], reason: DraftCommandDropReason) => void;
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
  /**
   * Close this scene's sessions at once, sending nothing more: for a scene
   * that was deleted. Reaches a session still draining after its editor
   * closed, so it is safe to call after the editor unmounts.
   */
  abandon: () => void;
}

const UNSAVED_PROMPT = "Changes to this scene are still being saved.";

interface OpenSession {
  /** `${instanceId}:${engineSceneId}`, to find a scene's sessions when it is deleted. */
  sceneKey: string;
  /** Whether the editor holds unsaved changes the session does not carry; false once it unmounts. */
  unsavedOutsideSession: () => boolean;
}

/**
 * Every session that is open: a mounted editor's, and one still draining
 * after its editor unmounted. A single beforeunload listener, on the window
 * while any is here, asks before the tab closes on unsent work of any of
 * them. Closing the tab skips React's cleanup, so it also sends what each
 * mounted editor has waiting.
 */
const openSessions = new Map<SceneEditorClient, OpenSession>();

function sceneKeyOf(instanceId: string, engineSceneId: string): string {
  return `${instanceId}:${engineSceneId}`;
}

function askBeforeUnload(event: BeforeUnloadEvent): void {
  let unsent = false;
  for (const [client, session] of openSessions) {
    client.flush();
    if (client.hasPending() || client.isDraining() || session.unsavedOutsideSession()) {
      unsent = true;
    }
  }
  if (unsent) {
    event.preventDefault();
    // Browsers that predate preventDefault here prompt only for a non-empty returnValue.
    event.returnValue = UNSAVED_PROMPT;
  }
}

function registerSession(client: SceneEditorClient, session: OpenSession): void {
  if (openSessions.size === 0) {
    window.addEventListener("beforeunload", askBeforeUnload);
  }
  openSessions.set(client, session);
}

function unregisterSession(client: SceneEditorClient): void {
  if (!openSessions.delete(client)) {
    return;
  }
  if (openSessions.size === 0) {
    window.removeEventListener("beforeunload", askBeforeUnload);
  }
}

function abandonScene(sceneKey: string): void {
  for (const [client, session] of [...openSessions]) {
    if (session.sceneKey === sceneKey) {
      // Its onClose unregisters it.
      client.abandon();
    }
  }
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
  onDraftCommandsDropped,
}: UseSceneEditorSessionArgs): SceneEditorSessionHandle {
  const getSession = useAction(api.sceneActions.getSceneEditorSession);
  const getPreviewUrl = useAction(api.browserSource.getOrCreatePreviewUrl);
  const [state, setState] = useState<EditorState>(IDLE);
  const clientRef = useRef<SceneEditorClient | null>(null);
  const versionRef = useRef(version);
  versionRef.current = version;
  const unsavedOutsideSessionRef = useRef(unsavedOutsideSession);
  unsavedOutsideSessionRef.current = unsavedOutsideSession;
  const onDraftCommandsDroppedRef = useRef(onDraftCommandsDropped);
  onDraftCommandsDroppedRef.current = onDraftCommandsDropped;

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
      onClose: () => unregisterSession(client),
      onDraftCommandsDropped: (commands, reason) => onDraftCommandsDroppedRef.current(commands, reason),
      version: versionRef.current,
    });
    const sceneKey = sceneKeyOf(instanceId, engineSceneId);
    registerSession(client, { sceneKey, unsavedOutsideSession: () => unsavedOutsideSessionRef.current });
    clientRef.current = client;
    client.start();
    return () => {
      client.stop();
      if (client.isDraining()) {
        // The editor saves its own unsaved changes as it unmounts.
        registerSession(client, { sceneKey, unsavedOutsideSession: () => false });
      } else {
        unregisterSession(client);
      }
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
  const abandon = useCallback(() => abandonScene(sceneKeyOf(instanceId, engineSceneId)), [instanceId, engineSceneId]);

  return { state, edit, publish, discard, setPresence, abandon };
}
