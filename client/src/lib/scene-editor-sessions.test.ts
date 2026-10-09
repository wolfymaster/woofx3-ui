import { describe, expect, it } from "bun:test";
import type { DraftCommand } from "@/lib/scene-editor-client";
import {
  createSceneEditorSessions,
  sceneKeyOf,
  type TrackedSession,
  type UnloadTarget,
} from "@/lib/scene-editor-sessions";

class FakeWindow implements UnloadTarget {
  readonly listeners = new Set<(event: BeforeUnloadEvent) => void>();
  addEventListener(_type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void {
    this.listeners.delete(listener);
  }
  /** Closes the tab: whether a listener asked first. */
  unload(): boolean {
    let asked = false;
    const event = {
      returnValue: "",
      preventDefault: () => {
        asked = true;
      },
    } as unknown as BeforeUnloadEvent;
    for (const listener of this.listeners) {
      listener(event);
    }
    return asked;
  }
}

function fakeSession(pending = false) {
  const session = {
    pending,
    flushed: 0,
    abandoned: false,
    command: null as DraftCommand | null,
    flush() {
      session.flushed += 1;
    },
    hasPending() {
      return session.pending;
    },
    abandon() {
      session.abandoned = true;
    },
    pendingCommand() {
      return session.command;
    },
  } satisfies TrackedSession & Record<string, unknown>;
  return session;
}

describe("sceneEditorSessions", () => {
  it("listens for the tab closing only while something is tracked", () => {
    const window = new FakeWindow();
    const sessions = createSceneEditorSessions(window);
    expect(window.listeners.size).toBe(0);
    const unregister = sessions.register(fakeSession(), "i:s");
    const unregisterCheck = sessions.registerUnsavedCheck(() => false);
    expect(window.listeners.size).toBe(1);
    unregister();
    expect(window.listeners.size).toBe(1);
    unregisterCheck();
    expect(window.listeners.size).toBe(0);
    // A second call changes nothing.
    unregister();
    expect(window.listeners.size).toBe(0);
  });

  it("asks before the tab closes on a session's pending work, flushing it first", () => {
    const window = new FakeWindow();
    const sessions = createSceneEditorSessions(window);
    const quiet = fakeSession(false);
    const busy = fakeSession(false);
    sessions.register(quiet, "i:a");
    sessions.register(busy, "i:b");
    expect(window.unload()).toBe(false);
    busy.pending = true;
    expect(window.unload()).toBe(true);
    expect(quiet.flushed).toBe(2);
    expect(busy.flushed).toBe(2);
  });

  it("asks before the tab closes on unsaved changes no session carries", () => {
    const window = new FakeWindow();
    const sessions = createSceneEditorSessions(window);
    let unsaved = false;
    sessions.registerUnsavedCheck(() => unsaved);
    expect(window.unload()).toBe(false);
    unsaved = true;
    expect(window.unload()).toBe(true);
  });

  it("abandons every session of a deleted scene, and only those", () => {
    const sessions = createSceneEditorSessions(null);
    const draining = fakeSession(true);
    const mounted = fakeSession();
    const other = fakeSession();
    sessions.register(draining, sceneKeyOf("i1", "s1"));
    sessions.register(mounted, sceneKeyOf("i1", "s1"));
    sessions.register(other, sceneKeyOf("i1", "s2"));
    sessions.abandonScene(sceneKeyOf("i1", "s1"));
    expect(draining.abandoned).toBe(true);
    expect(mounted.abandoned).toBe(true);
    expect(other.abandoned).toBe(false);
  });

  it("tells one instance's scene from another's with the same id", () => {
    const sessions = createSceneEditorSessions(null);
    const session = fakeSession();
    sessions.register(session, sceneKeyOf("i1", "s1"));
    sessions.abandonScene(sceneKeyOf("i2", "s1"));
    expect(session.abandoned).toBe(false);
  });

  it("locks a scene's draft on a command any of its sessions waits on, until it is answered", () => {
    const sessions = createSceneEditorSessions(null);
    const draining = fakeSession(true);
    const reopened = fakeSession();
    const other = fakeSession();
    sessions.register(draining, sceneKeyOf("i1", "s1"));
    sessions.register(reopened, sceneKeyOf("i1", "s1"));
    sessions.register(other, sceneKeyOf("i1", "s2"));
    let notified = 0;
    const unsubscribe = sessions.subscribe(() => {
      notified += 1;
    });
    draining.command = "publish";
    sessions.commandChanged();
    expect(notified).toBe(1);
    expect(sessions.commandOf(sceneKeyOf("i1", "s1"))).toBe("publish");
    expect(sessions.commandOf(sceneKeyOf("i1", "s2"))).toBeNull();
    draining.command = null;
    sessions.commandChanged();
    expect(sessions.commandOf(sceneKeyOf("i1", "s1"))).toBeNull();
    unsubscribe();
    sessions.commandChanged();
    expect(notified).toBe(2);
  });

  it("lifts the lock when the session holding the command closes", () => {
    const sessions = createSceneEditorSessions(null);
    const draining = fakeSession(true);
    draining.command = "discard";
    const unregister = sessions.register(draining, sceneKeyOf("i1", "s1"));
    let notified = 0;
    sessions.subscribe(() => {
      notified += 1;
    });
    expect(sessions.commandOf(sceneKeyOf("i1", "s1"))).toBe("discard");
    unregister();
    expect(notified).toBe(1);
    expect(sessions.commandOf(sceneKeyOf("i1", "s1"))).toBeNull();
  });
});
