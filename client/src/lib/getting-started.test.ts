import { describe, expect, test } from "bun:test";
import { type GettingStartedFacts, gettingStartedItems, gettingStartedProgress } from "./getting-started";

const twitch = { marketplaceModuleId: "woofx3_twitch", name: "Twitch", approvedPermissions: [] };
const obs = { marketplaceModuleId: "woofx3_obs", name: "OBS", approvedPermissions: [] };

function facts(overrides: Partial<GettingStartedFacts> = {}, setup: Partial<GettingStartedFacts["setup"]> = {}) {
  const base: GettingStartedFacts = {
    setup: {
      platformsChosenAt: 1,
      completedAt: 2,
      platforms: [twitch],
      moduleInstalls: [{ marketplaceModuleId: "woofx3_twitch", status: "installed" }],
      twitchUsername: "streamer",
      engineRegistered: true,
      platformsNeedingSettings: [],
    },
    overlays: { hasScene: true, browserSourceKeyCount: 1, featuredKey: "k", lastLoadedAt: 3 },
    browserSourceUrl: "https://example.test/browser-source/k",
    doneItemIds: ["test-follow", "chat-command"],
    obsStatus: null,
  };
  return { ...base, ...overrides, setup: { ...base.setup, ...setup } };
}

function byId(input: GettingStartedFacts) {
  return Object.fromEntries(gettingStartedItems(input).map((entry) => [entry.id, entry]));
}

describe("gettingStartedItems", () => {
  test("is all done for a finished first session", () => {
    const items = gettingStartedItems(facts());
    expect(items.every((entry) => entry.status === "done")).toBe(true);
    expect(gettingStartedProgress(items)).toEqual({ done: 6, total: 6 });
  });

  test("points unfinished setup back to the wizard", () => {
    const item = byId(facts({}, { completedAt: null })).setup;
    expect(item.status).toBe("todo");
    expect(item.fixes).toEqual([{ kind: "route", label: "Continue setup", href: "/setup" }]);
  });

  test("waits for the engine before installing platforms", () => {
    const item = byId(facts({}, { moduleInstalls: [], engineRegistered: false })).platforms;
    expect(item.status).toBe("todo");
    expect(item.summary).toBe("They install as soon as your engine is ready");
  });

  test("offers a retry when a platform failed to install", () => {
    const item = byId(
      facts(
        {},
        {
          platforms: [twitch, obs],
          moduleInstalls: [
            { marketplaceModuleId: "woofx3_twitch", status: "installed" },
            { marketplaceModuleId: "woofx3_obs", status: "failed", error: "boom" },
          ],
        }
      )
    ).platforms;
    expect(item.status).toBe("problem");
    expect(item.summary).toBe("OBS did not install");
    expect(item.actions).toEqual([{ kind: "retry-installs", label: "Retry" }]);
  });

  test("sends a platform needing new permissions to its module page", () => {
    const item = byId(
      facts(
        {},
        { moduleInstalls: [{ marketplaceModuleId: "woofx3_twitch", status: "needs_approval", unapproved: ["x"] }] }
      )
    ).platforms;
    expect(item.status).toBe("problem");
    expect(item.fixes).toEqual([{ kind: "route", label: "Review Twitch", href: "/modules/woofx3_twitch" }]);
  });

  test("offers the browser-source URL while OBS has not loaded an overlay", () => {
    const item = byId(
      facts({ overlays: { hasScene: true, browserSourceKeyCount: 1, featuredKey: "k", lastLoadedAt: null } })
    ).overlay;
    expect(item.status).toBe("todo");
    expect(item.fixes[0]).toEqual({
      kind: "copy",
      label: "Copy browser-source URL",
      text: "https://example.test/browser-source/k",
    });
  });

  test("asks for a scene first when there is none", () => {
    const item = byId(
      facts({ overlays: { hasScene: false, browserSourceKeyCount: 0, featuredKey: null, lastLoadedAt: null } })
    ).overlay;
    expect(item.fixes).toEqual([{ kind: "route", label: "Open scenes", href: "/stream/scenes" }]);
  });

  test("keeps the recorded items to do until the card records them", () => {
    const items = byId(facts({ doneItemIds: [] }));
    expect(items["test-follow"].actions).toEqual([{ kind: "fire-test-follow", label: "Send a test follow" }]);
    expect(items["chat-command"].actions).toEqual([{ kind: "mark-command-done", label: "I've tried it" }]);
  });

  test("asks for the settings of a platform that declares them until marked done", () => {
    const spotify = { marketplaceModuleId: "woofx3_spotify", name: "Spotify", approvedPermissions: [] };
    const setup = { platforms: [twitch, spotify], platformsNeedingSettings: ["woofx3_spotify"] };
    const todo = byId(facts({}, setup))["platform-settings:woofx3_spotify"];
    expect(todo.status).toBe("todo");
    expect(todo.fixes).toEqual([{ kind: "route", label: "Open Spotify", href: "/modules/woofx3_spotify" }]);
    expect(todo.actions).toEqual([
      { kind: "mark-platform-settings-done", label: "Done", marketplaceModuleId: "woofx3_spotify" },
    ]);

    const done = byId(
      facts({ doneItemIds: ["test-follow", "chat-command", "platform-settings:woofx3_spotify"] }, setup)
    )["platform-settings:woofx3_spotify"];
    expect(done.status).toBe("done");
  });

  test("completes setting up OBS once the engine reports it connected", () => {
    const setup = { platforms: [twitch, obs], platformsNeedingSettings: ["woofx3_obs"] };
    const connected = byId(facts({ obsStatus: { state: "connected", failure: null, address: "obs.lan:4455" } }, setup))[
      "platform-settings:woofx3_obs"
    ];
    expect(connected.status).toBe("done");
    expect(connected.summary).toBe("Connected to OBS at obs.lan:4455");

    const refused = byId(
      facts({ obsStatus: { state: "retrying", failure: "authentication", address: "obs.lan:4455" } }, setup)
    )["platform-settings:woofx3_obs"];
    expect(refused.status).toBe("problem");
    expect(refused.actions).toEqual([]);
    expect(refused.fixes).toEqual([{ kind: "route", label: "Open OBS", href: "/modules/woofx3_obs" }]);
  });

  test("keeps the Done button for OBS when the engine cannot report its connection", () => {
    const setup = { platforms: [twitch, obs], platformsNeedingSettings: ["woofx3_obs"] };
    const item = byId(facts({ doneItemIds: [] }, setup))["platform-settings:woofx3_obs"];
    expect(item.actions.map((action) => action.kind)).toEqual(["mark-platform-settings-done"]);
  });
});
