import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneDocument, SceneVersion } from "@/lib/scene-document";
import { type EditorState, SceneEditorClient } from "@/lib/scene-editor-client";

interface UseSceneEditorSessionArgs {
  instanceId: Id<"instances">;
  engineSceneId: string;
  /** The Convex scene, whose preview URL names sceneManager's public origin. */
  sceneId: Id<"scenes"> | undefined;
  /** False for an engine without `scenes.editorSessions`: the hook stays idle. */
  enabled: boolean;
}

export interface SceneEditorSessionHandle {
  state: EditorState;
  /** The editor changed its canvas; sent within a fifth of a second. */
  edit: (doc: SceneDocument) => void;
  publish: () => void;
  discard: () => void;
  /** Edit the published scene (live) or the draft. */
  setVersion: (version: SceneVersion) => void;
}

const IDLE: EditorState = { status: "connecting", doc: null, meta: {}, hasDraft: false };

/**
 * The scene editor's connection to sceneManager: a short-lived token from the
 * engine (through Convex) opens sceneManager's editor socket, at the origin the
 * scene's preview overlay is served from. See `SceneEditorClient`.
 */
export function useSceneEditorSession({
  instanceId,
  engineSceneId,
  sceneId,
  enabled,
}: UseSceneEditorSessionArgs): SceneEditorSessionHandle {
  const getSession = useAction(api.sceneActions.getSceneEditorSession);
  const getPreviewUrl = useAction(api.browserSource.getOrCreatePreviewUrl);
  const [state, setState] = useState<EditorState>(IDLE);
  const clientRef = useRef<SceneEditorClient | null>(null);

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
    });
    clientRef.current = client;
    client.start();
    return () => {
      client.stop();
      clientRef.current = null;
      setState(IDLE);
    };
  }, [enabled, sceneId, instanceId, engineSceneId, getSession, getPreviewUrl]);

  const edit = useCallback((doc: SceneDocument) => clientRef.current?.edit(doc), []);
  const publish = useCallback(() => clientRef.current?.publish(), []);
  const discard = useCallback(() => clientRef.current?.discard(), []);
  const setVersion = useCallback((version: SceneVersion) => clientRef.current?.setVersion(version), []);

  return { state, edit, publish, discard, setVersion };
}
