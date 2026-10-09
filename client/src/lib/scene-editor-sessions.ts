/**
 * Every scene editor session open in this tab, and the checks the tab makes
 * before it closes.
 *
 * A session outlives its editor: closing the editor leaves it delivering what
 * it has pending (see `SceneEditorClient.stop`). So a scene's sessions are
 * found here rather than through the mounted editor, to close them when the
 * scene is deleted, and closing the tab asks first while any of them, or any
 * mounted editor's own unsaved fields, has work not yet through.
 */

/** The slice of `SceneEditorClient` this needs. */
export interface TrackedSession {
  /** Send what the editor changed now, rather than at the next tick. */
  flush(): void;
  /** Whether anything asked of the session is not through yet. */
  hasPending(): boolean;
  /** Close at once, sending nothing more. */
  abandon(): void;
}

/** The slice of `window` this needs (injectable for tests). */
export interface UnloadTarget {
  addEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
}

export interface SceneEditorSessions {
  /** Track an open session of a scene until the returned function is called. */
  register(session: TrackedSession, sceneKey: string): () => void;
  /**
   * Track a check for unsaved changes no session carries (an editor's scene
   * name and description) until the returned function is called.
   */
  registerUnsavedCheck(check: () => boolean): () => void;
  /** Abandon every session of a scene, including one still draining after its editor closed. */
  abandonScene(sceneKey: string): void;
  /**
   * Whether closing the tab now would lose work. Flushes each session first:
   * closing the tab skips React's cleanup, so this is the last chance to send.
   */
  hasUnsentWork(): boolean;
}

const UNSAVED_PROMPT = "Changes to this scene are still being saved.";

export function sceneKeyOf(instanceId: string, engineSceneId: string): string {
  return `${instanceId}:${engineSceneId}`;
}

/**
 * One `beforeunload` listener is on `target` while anything is tracked, and
 * asks before the tab closes on unsent work of any of it.
 */
export function createSceneEditorSessions(target: UnloadTarget | null): SceneEditorSessions {
  const sessions = new Map<TrackedSession, string>();
  const unsavedChecks = new Set<() => boolean>();
  let listening = false;

  const hasUnsentWork = (): boolean => {
    let unsent = false;
    for (const session of sessions.keys()) {
      session.flush();
      if (session.hasPending()) {
        unsent = true;
      }
    }
    for (const check of unsavedChecks) {
      if (check()) {
        unsent = true;
      }
    }
    return unsent;
  };

  const askBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (hasUnsentWork()) {
      event.preventDefault();
      // Browsers that predate preventDefault here prompt only for a non-empty returnValue.
      event.returnValue = UNSAVED_PROMPT;
    }
  };

  const syncListener = (): void => {
    const needed = sessions.size > 0 || unsavedChecks.size > 0;
    if (needed && !listening) {
      target?.addEventListener("beforeunload", askBeforeUnload);
    } else if (!needed && listening) {
      target?.removeEventListener("beforeunload", askBeforeUnload);
    }
    listening = needed;
  };

  return {
    register(session, sceneKey) {
      sessions.set(session, sceneKey);
      syncListener();
      return () => {
        if (sessions.delete(session)) {
          syncListener();
        }
      };
    },
    registerUnsavedCheck(check) {
      unsavedChecks.add(check);
      syncListener();
      return () => {
        if (unsavedChecks.delete(check)) {
          syncListener();
        }
      };
    },
    abandonScene(sceneKey) {
      for (const [session, key] of [...sessions]) {
        if (key === sceneKey) {
          session.abandon();
        }
      }
    },
    hasUnsentWork,
  };
}

/** The tab's sessions. */
export const sceneEditorSessions = createSceneEditorSessions(typeof window === "undefined" ? null : window);
