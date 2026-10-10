import { describe, expect, it } from "bun:test";
import { BACKOFF_BASE_MS, SceneSyncClient, type SyncSocketHandlers } from "@woofx3/api/scene-editor/client";
import type { SceneDocument } from "@woofx3/api/scene-editor/document";
import { createSceneEditorSessions, sceneKeyOf } from "@/lib/scene-editor-sessions";
import { SceneSocketOpener, type SceneSocketSource } from "@/lib/scene-sync-browser";
import { TestClock, TestSceneServer } from "@/lib/scene-sync-test-server";

/** A source like an editor's: its scene's preview origin and a token naming the editor. */
function sourceFor(editor: string, origin: string): SceneSocketSource {
  return {
    getGrant: async () => ({ token: `token-${editor}`, path: "/scene/s1/edit" }),
    getPreviewUrl: async () => `${origin}/scene/s1/preview`,
  };
}

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

describe("SceneSocketOpener", () => {
  it("reads its source at every open, so a later render's arguments are used", async () => {
    const ref: { current: SceneSocketSource | null } = { current: sourceFor("a", "https://old.example") };
    const opener = new SceneSocketOpener(ref);
    expect(await opener.open()).toBe("wss://old.example/scene/s1/edit?token=token-a&protocol=2");
    ref.current = sourceFor("a", "https://new.example");
    expect(await opener.open()).toBe("wss://new.example/scene/s1/edit?token=token-a&protocol=2");
  });

  it("reads the source it follows last", async () => {
    const opener = new SceneSocketOpener({ current: sourceFor("a", "https://a.example") });
    opener.follow({ current: sourceFor("b", "https://b.example") });
    expect(await opener.open()).toBe("wss://b.example/scene/s1/edit?token=token-b&protocol=2");
  });

  it("opens nothing without a source, a grant or a preview URL", async () => {
    expect(await new SceneSocketOpener({ current: null }).open()).toBeNull();
    const noGrant = new SceneSocketOpener({
      current: { getGrant: async () => null, getPreviewUrl: async () => "https://a.example/p" },
    });
    expect(await noGrant.open()).toBeNull();
  });

  it("reconnects a client taken over by a remounted editor with that editor's arguments", async () => {
    const clock = new TestClock();
    const server = new TestSceneServer(clock, doc());
    const urls: string[] = [];
    const connect = (url: string, handlers: SyncSocketHandlers) => {
      urls.push(url);
      return server.connect(url, handlers);
    };
    const sessions = createSceneEditorSessions<SceneSyncClient>(null);
    const scene = sceneKeyOf("i1", "s1");
    const openers = new WeakMap<SceneSyncClient, SceneSocketOpener>();
    const factory = (source: { current: SceneSocketSource | null }) => () => {
      const opener = new SceneSocketOpener(source);
      const made = new SceneSyncClient({
        open: opener.open,
        connect,
        clock,
        newClientId: () => "client-1",
        name: "Editor",
      });
      openers.set(made, opener);
      return made;
    };

    const firstSource = { current: sourceFor("first", "https://first.example") };
    const first = sessions.acquire(scene, factory(firstSource));
    openers.get(first)?.follow(firstSource);
    await server.run();
    expect(first.getState().conn).toBe("ready");

    // The editor closes with an edit unsent; the next editor of the scene,
    // whose Convex row and actions differ, takes the draining client.
    server.disconnectAll();
    first.edit("draft", (d) => {
      d.widgets.w!.x = 10;
      return d;
    });
    sessions.release(scene, first);
    const secondSource = { current: sourceFor("second", "https://second.example") };
    const second = sessions.acquire(scene, factory(secondSource));
    expect(second).toBe(first);
    openers.get(second)?.follow(secondSource);

    await clock.advance(BACKOFF_BASE_MS);
    await server.run();
    await clock.advance(200);
    await server.run();
    expect(urls.at(-1)).toBe("wss://second.example/scene/s1/edit?token=token-second&protocol=2");
    expect(second.hasPending()).toBe(false);
    expect(server.state.docs.draft.widgets.w!.x).toBe(10);
  });
});
