import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { SceneSyncClient, type SceneSyncState } from "@woofx3/api/scene-editor/client";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/hooks/use-toast";
import { sceneEditorSessions, sceneKeyOf } from "@/lib/scene-editor-sessions";
import { browserClock, connectBrowserSocket, editorSocketUrl } from "@/lib/scene-sync-browser";
import { syncReportToast } from "@/lib/scene-sync-report";

interface UseSceneEditorSessionArgs {
  instanceId: Id<"instances">;
  engineSceneId: string;
  /** The Convex scene, whose preview URL names sceneManager's public origin. */
  sceneId: Id<"scenes"> | undefined;
  /** False for an engine without `scenes.editorSync`: the hook stays idle. */
  enabled: boolean;
  /** Who this editor is, shown to the scene's other editors; the session waits for it. */
  editorName: string | undefined;
  /**
   * Whether the editor holds changes the session does not carry (the scene's
   * name and description) that are not saved yet; closing the tab asks first
   * while they are, as it does for the session's own pending items.
   */
  unsavedOutsideSession: boolean;
}

export interface SceneEditorSession {
  /** The scene's sync client, or null while the session is idle. */
  client: SceneSyncClient | null;
  /** The client's state, or null with no client. */
  state: SceneSyncState | null;
  /**
   * Close the scene's client at once, sending nothing more: for a scene that
   * was deleted. Reaches a client still draining after its editor closed.
   */
  abandon: () => void;
}

const noClient = (): (() => void) => () => {};
const noState = (): null => null;

/**
 * The scene editor's connection to sceneManager: a short-lived token from the
 * engine (through Convex) opens sceneManager's editor socket, at the origin
 * the scene's preview overlay is served from. The tab keeps one client per
 * scene (`sceneEditorSessions`): an editor that mounts while the scene's
 * client still drains after the last one closed takes that client back.
 *
 * Reports go to a toast naming the scene as the client last had it, since
 * a client that drains after its editor closed may report when another scene
 * is open.
 */
export function useSceneEditorSession({
  instanceId,
  engineSceneId,
  sceneId,
  enabled,
  editorName,
  unsavedOutsideSession,
}: UseSceneEditorSessionArgs): SceneEditorSession {
  const getSession = useAction(api.sceneActions.getSceneEditorSession);
  const getPreviewUrl = useAction(api.browserSource.getOrCreatePreviewUrl);
  const [sceneKey] = useState(() => sceneKeyOf(instanceId, engineSceneId));
  const [client, setClient] = useState<SceneSyncClient | null>(null);
  const unsavedOutsideSessionRef = useRef(unsavedOutsideSession);
  unsavedOutsideSessionRef.current = unsavedOutsideSession;
  const editorNameRef = useRef(editorName);
  editorNameRef.current = editorName;
  const hasName = editorName !== undefined;

  // The editor saves its own unsaved fields as it unmounts.
  useEffect(() => sceneEditorSessions.registerUnsavedCheck(() => unsavedOutsideSessionRef.current), []);

  useEffect(() => {
    if (!enabled || !sceneId || !hasName) {
      return;
    }
    const acquired = sceneEditorSessions.acquire(sceneKey, () => {
      const made: SceneSyncClient = new SceneSyncClient({
        open: async () => {
          const [grant, previewUrl] = await Promise.all([
            getSession({ instanceId, engineSceneId }),
            getPreviewUrl({ sceneId }),
          ]);
          if (!grant || !previewUrl) {
            return null;
          }
          return editorSocketUrl(grant, previewUrl);
        },
        connect: connectBrowserSocket,
        clock: browserClock,
        newClientId: () => crypto.randomUUID(),
        name: editorNameRef.current ?? "",
        onReport: (report) =>
          toast({ ...syncReportToast(report, made.getState().name || undefined), variant: "destructive" }),
        log: (event, detail) => console.warn(`[scene editor] ${event}`, detail ?? {}),
      });
      return made;
    });
    setClient(acquired);
    return () => {
      sceneEditorSessions.release(sceneKey, acquired);
      setClient(null);
    };
  }, [enabled, sceneId, hasName, sceneKey, instanceId, engineSceneId, getSession, getPreviewUrl]);

  const state = useSyncExternalStore(client?.subscribe ?? noClient, client?.getState ?? noState);

  const abandon = useCallback(() => sceneEditorSessions.abandonScene(sceneKey), [sceneKey]);

  return { client, state, abandon };
}
