/**
 * The scene sync clients open in this tab, one per scene, and the checks the
 * tab makes before it closes.
 *
 * A client outlives its editor: closing the editor stops it, and a stopped
 * client keeps delivering what it has pending until it is through or its
 * deadline passes (`SceneSyncClient.stop`). Opening the scene again
 * meanwhile takes the same client back (`resume`) rather than starting a
 * second one beside it, so the scene's edits stay in one queue. A client is
 * forgotten once it has ended and no editor holds it. Closing the tab asks
 * first while any client has something pending, or a mounted editor has
 * fields of its own unsaved.
 */

import type { ConnState, SceneSyncClient } from "@woofx3/api/scene-editor/client";

/** The slice of `SceneSyncClient` the registry needs. */
export interface TrackedClient {
  start(): void;
  /** Finish delivering what is pending, then close. */
  stop(): void;
  /** Cancel `stop()`. False when the client already ended. */
  resume(): boolean;
  /** Close now, delivering nothing more. */
  abandon(): void;
  hasPending(): boolean;
  subscribe(listener: () => void): () => void;
  getState(): { conn: ConnState };
}

/** The slice of `window` this needs (injectable for tests). */
export interface UnloadTarget {
  addEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
}

export interface SceneEditorSessions<C extends TrackedClient> {
  /**
   * The scene's client, for an editor that has just mounted: the one still
   * open from an editor that closed, resumed, or else a new one from
   * `factory`, started. Hand it back with `release` when the editor unmounts.
   */
  acquire(sceneKey: string, factory: () => C): C;
  /** An editor that acquired `client` unmounted. The last one out stops it. */
  release(sceneKey: string, client: C): void;
  /**
   * Track a check for unsaved changes no client carries (an editor's scene
   * name and description) until the returned function is called.
   */
  registerUnsavedCheck(check: () => boolean): () => void;
  /** Close the scene's client at once, including one still delivering after its editor closed. */
  abandonScene(sceneKey: string): void;
  /** Whether closing the tab now would lose work. */
  hasUnsentWork(): boolean;
}

interface Entry<C> {
  client: C;
  /** Mounted editors holding the client. */
  holders: number;
  unsubscribe: () => void;
}

const UNSAVED_PROMPT = "Changes to this scene are still being saved.";

export function sceneKeyOf(instanceId: string, engineSceneId: string): string {
  return `${instanceId}:${engineSceneId}`;
}

function hasEnded(client: TrackedClient): boolean {
  const { conn } = client.getState();
  return conn === "closed" || conn === "gone";
}

/** One `beforeunload` listener is on `target` while any client or unsaved check is tracked. */
export function createSceneEditorSessions<C extends TrackedClient>(
  target: UnloadTarget | null
): SceneEditorSessions<C> {
  const entries = new Map<string, Entry<C>>();
  const unsavedChecks = new Set<() => boolean>();
  let listening = false;

  const hasUnsentWork = (): boolean => {
    for (const { client } of entries.values()) {
      if (client.hasPending()) {
        return true;
      }
    }
    for (const check of unsavedChecks) {
      if (check()) {
        return true;
      }
    }
    return false;
  };

  const askBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (hasUnsentWork()) {
      event.preventDefault();
      // Browsers that predate preventDefault here prompt only for a non-empty returnValue.
      event.returnValue = UNSAVED_PROMPT;
    }
  };

  const syncListener = (): void => {
    const needed = entries.size > 0 || unsavedChecks.size > 0;
    if (needed && !listening) {
      target?.addEventListener("beforeunload", askBeforeUnload);
    } else if (!needed && listening) {
      target?.removeEventListener("beforeunload", askBeforeUnload);
    }
    listening = needed;
  };

  const forget = (sceneKey: string, entry: Entry<C>): void => {
    entry.unsubscribe();
    entries.delete(sceneKey);
    syncListener();
  };

  /** Drop the scene's entry once no editor holds its client and the client has ended. */
  const forgetIfDone = (sceneKey: string, entry: Entry<C>): void => {
    if (entry.holders === 0 && hasEnded(entry.client) && entries.get(sceneKey) === entry) {
      forget(sceneKey, entry);
    }
  };

  return {
    acquire(sceneKey, factory) {
      const existing = entries.get(sceneKey);
      if (existing !== undefined) {
        if (existing.client.resume()) {
          existing.holders++;
          return existing.client;
        }
        // Ended while an editor still held it (the scene is gone, or the
        // engine ended the session for good): this editor starts over.
        forget(sceneKey, existing);
      }
      const client = factory();
      const entry: Entry<C> = { client, holders: 1, unsubscribe: () => {} };
      entry.unsubscribe = client.subscribe(() => forgetIfDone(sceneKey, entry));
      entries.set(sceneKey, entry);
      syncListener();
      client.start();
      return client;
    },
    release(sceneKey, client) {
      const entry = entries.get(sceneKey);
      if (entry === undefined || entry.client !== client || entry.holders === 0) {
        return;
      }
      entry.holders--;
      if (entry.holders === 0) {
        client.stop();
      }
      forgetIfDone(sceneKey, entry);
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
      entries.get(sceneKey)?.client.abandon();
    },
    hasUnsentWork,
  };
}

/** The tab's clients. */
export const sceneEditorSessions = createSceneEditorSessions<SceneSyncClient>(
  typeof window === "undefined" ? null : window
);
