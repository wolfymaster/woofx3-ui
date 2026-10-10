import { describe, expect, it } from "bun:test";
import { BACKOFF_BASE_MS, type ConnState, SceneSyncClient } from "@woofx3/api/scene-editor/client";
import type { SceneDocument } from "@woofx3/api/scene-editor/document";
import {
  createSceneEditorSessions,
  sceneKeyOf,
  type TrackedClient,
  type UnloadTarget,
} from "@/lib/scene-editor-sessions";
import { TestClock, TestSceneServer } from "@/lib/scene-sync-test-server";

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

/** A client that ends when stopped with nothing pending, as `SceneSyncClient` does. */
class FakeClient implements TrackedClient {
  conn: ConnState = "connecting";
  pending = false;
  started = 0;
  stopping = false;
  private readonly listeners = new Set<() => void>();

  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopping = true;
    if (!this.pending) {
      this.end("closed");
    }
  }
  resume(): boolean {
    if (this.conn === "closed" || this.conn === "gone") {
      return false;
    }
    this.stopping = false;
    return true;
  }
  abandon(): void {
    this.pending = false;
    this.end("closed");
  }
  hasPending(): boolean {
    return this.pending;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getState(): { conn: ConnState } {
    return { conn: this.conn };
  }
  /** Delivers what was pending; a stopped client then ends. */
  drain(): void {
    this.pending = false;
    if (this.stopping) {
      this.end("closed");
    }
  }
  end(conn: "closed" | "gone"): void {
    this.conn = conn;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

const SCENE = sceneKeyOf("i1", "s1");

describe("sceneEditorSessions", () => {
  it("starts one client per scene and stops it when its editor leaves", () => {
    const sessions = createSceneEditorSessions<FakeClient>(null);
    const client = sessions.acquire(SCENE, () => new FakeClient());
    expect(client.started).toBe(1);
    sessions.release(SCENE, client);
    expect(client.conn).toBe("closed");
    const next = sessions.acquire(SCENE, () => new FakeClient());
    expect(next).not.toBe(client);
  });

  it("hands a remounted editor the client still draining from the last one, resumed", () => {
    const sessions = createSceneEditorSessions<FakeClient>(null);
    const client = sessions.acquire(SCENE, () => new FakeClient());
    client.pending = true;
    sessions.release(SCENE, client);
    expect(client.stopping).toBe(true);
    let made = 0;
    const again = sessions.acquire(SCENE, () => {
      made++;
      return new FakeClient();
    });
    expect(again).toBe(client);
    expect(made).toBe(0);
    expect(client.stopping).toBe(false);
    expect(client.started).toBe(1);
  });

  it("stops a shared client only when the last editor holding it leaves", () => {
    const sessions = createSceneEditorSessions<FakeClient>(null);
    const first = sessions.acquire(SCENE, () => new FakeClient());
    const second = sessions.acquire(SCENE, () => new FakeClient());
    expect(second).toBe(first);
    sessions.release(SCENE, first);
    expect(first.stopping).toBe(false);
    sessions.release(SCENE, second);
    expect(first.conn).toBe("closed");
  });

  it("forgets a draining client once it ends, and starts over after that", () => {
    const window = new FakeWindow();
    const sessions = createSceneEditorSessions<FakeClient>(window);
    const client = sessions.acquire(SCENE, () => new FakeClient());
    client.pending = true;
    sessions.release(SCENE, client);
    expect(window.listeners.size).toBe(1);
    client.drain();
    expect(window.listeners.size).toBe(0);
    expect(sessions.acquire(SCENE, () => new FakeClient())).not.toBe(client);
  });

  it("replaces a client that ended while its editor was open", () => {
    const sessions = createSceneEditorSessions<FakeClient>(null);
    const client = sessions.acquire(SCENE, () => new FakeClient());
    client.end("gone");
    const fresh = sessions.acquire(SCENE, () => new FakeClient());
    expect(fresh).not.toBe(client);
    expect(fresh.started).toBe(1);
    // The old editor's release does not touch the new client.
    sessions.release(SCENE, client);
    expect(fresh.stopping).toBe(false);
  });

  it("asks before the tab closes while any client has something pending", () => {
    const window = new FakeWindow();
    const sessions = createSceneEditorSessions<FakeClient>(window);
    const quiet = sessions.acquire(sceneKeyOf("i1", "a"), () => new FakeClient());
    const busy = sessions.acquire(sceneKeyOf("i1", "b"), () => new FakeClient());
    expect(window.unload()).toBe(false);
    busy.pending = true;
    expect(window.unload()).toBe(true);
    // Still asked while it drains after its editor closed.
    sessions.release(sceneKeyOf("i1", "b"), busy);
    expect(window.unload()).toBe(true);
    busy.drain();
    expect(window.unload()).toBe(false);
    sessions.release(sceneKeyOf("i1", "a"), quiet);
    expect(window.listeners.size).toBe(0);
  });

  it("asks before the tab closes on unsaved changes no client carries", () => {
    const window = new FakeWindow();
    const sessions = createSceneEditorSessions<FakeClient>(window);
    let unsaved = false;
    const unregister = sessions.registerUnsavedCheck(() => unsaved);
    expect(window.unload()).toBe(false);
    unsaved = true;
    expect(window.unload()).toBe(true);
    unregister();
    expect(window.listeners.size).toBe(0);
  });

  it("abandons a deleted scene's client, draining or not, and no other", () => {
    const sessions = createSceneEditorSessions<FakeClient>(null);
    const draining = sessions.acquire(sceneKeyOf("i1", "s1"), () => new FakeClient());
    draining.pending = true;
    sessions.release(sceneKeyOf("i1", "s1"), draining);
    const sameIdOtherInstance = sessions.acquire(sceneKeyOf("i2", "s1"), () => new FakeClient());
    sessions.abandonScene(sceneKeyOf("i1", "s1"));
    expect(draining.conn).toBe("closed");
    expect(sameIdOtherInstance.conn).toBe("connecting");
    expect(sessions.hasUnsentWork()).toBe(false);
  });
});

function doc(): SceneDocument {
  return {
    layout: { width: 1920, height: 1080 },
    widgets: {
      w: {
        widget: "woofx3:widget:text",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        visible: true,
        z: "a0000",
        settings: {},
        name: "Text",
        rotation: 0,
        opacity: 1,
        locked: false,
        extra: {},
      },
    },
  };
}

describe("sceneEditorSessions with a real client", () => {
  it("keeps a remounted editor's edits in the draining client's queue, delivered in order", async () => {
    const clock = new TestClock();
    const server = new TestSceneServer(clock, doc());
    const sessions = createSceneEditorSessions<SceneSyncClient>(null);
    let made = 0;
    const factory = () => {
      made++;
      return new SceneSyncClient({
        open: async () => "ws://engine/scene/s1/edit?protocol=2",
        connect: server.connect,
        clock,
        newClientId: () => `client-${made}`,
        name: "Editor",
      });
    };
    const first = sessions.acquire(SCENE, factory);
    await server.run();
    expect(first.getState().conn).toBe("ready");

    // The editor closes with an edit unsent, while the connection is down.
    server.disconnectAll();
    first.edit("draft", (d) => {
      d.widgets.w!.x = 10;
      return d;
    });
    sessions.release(SCENE, first);
    expect(first.getState().stopping).toBe(true);

    // It opens again before the client drained, and edits on.
    const second = sessions.acquire(SCENE, factory);
    expect(second).toBe(first);
    expect(made).toBe(1);
    second.edit("draft", (d) => {
      d.widgets.w!.x += 5;
      return d;
    });
    await clock.advance(BACKOFF_BASE_MS);
    await server.run();
    await clock.advance(200);
    await server.run();
    expect(second.hasPending()).toBe(false);
    expect(server.state.docs.draft.widgets.w!.x).toBe(15);
  });
});
