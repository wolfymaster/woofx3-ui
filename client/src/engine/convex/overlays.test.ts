import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { SceneId } from "@/engine/types";
import { renderInScope } from "./render-in-scope";

// Convex answers a browser source with its own key; the gateway answers with
// the URL OBS loads, built from that key, so no screen builds one itself.

const calls: Array<{ name: string; args: unknown }> = [];
const answers: Record<string, unknown> = {};

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    const name = getFunctionName(action);
    calls.push({ name, args });
    return Promise.resolve(answers[name]);
  },
}));

const { convexOverlaysGateway } = await import("./overlays");

const sceneId = "scene-1" as SceneId;

// The browser-source URL is served from the Convex site, which Vite supplies
// from the environment at build time.
let siteUrlBefore: string | undefined;

beforeEach(() => {
  calls.length = 0;
  siteUrlBefore = process.env.VITE_CONVEX_SITE_URL;
  process.env.VITE_CONVEX_SITE_URL = "https://site.example";
});

afterEach(() => {
  if (siteUrlBefore === undefined) {
    delete process.env.VITE_CONVEX_SITE_URL;
  } else {
    process.env.VITE_CONVEX_SITE_URL = siteUrlBefore;
  }
});

describe("overlays", () => {
  test("a browser source is the URL for the scene's key", async () => {
    answers["browserSource:getOrCreateBrowserSourceKey"] = "key-1";
    const getUrl = renderInScope(() => convexOverlaysGateway.useBrowserSourceUrlRequest());
    expect(await getUrl(sceneId)).toBe("https://site.example/browser-source/key-1");
    expect(calls).toEqual([{ name: "browserSource:getOrCreateBrowserSourceKey", args: { sceneId: "scene-1" } }]);
  });

  test("rotating answers with the URL for the new key", async () => {
    answers["browserSource:rotateBrowserSourceKey"] = "key-2";
    const rotate = renderInScope(() => convexOverlaysGateway.useRotateBrowserSourceUrlRequest());
    expect(await rotate(sceneId)).toBe("https://site.example/browser-source/key-2");
    expect(calls).toEqual([{ name: "browserSource:rotateBrowserSourceKey", args: { sceneId: "scene-1" } }]);
  });

  test("a preview is the engine's URL, or null when there is none yet", async () => {
    const getPreview = renderInScope(() => convexOverlaysGateway.usePreviewUrlRequest());
    answers["browserSource:getOrCreatePreviewUrl"] = "https://engine.example/overlay?token=t";
    expect(await getPreview(sceneId)).toBe("https://engine.example/overlay?token=t");
    answers["browserSource:getOrCreatePreviewUrl"] = null;
    expect(await getPreview(sceneId)).toBeNull();
  });
});
