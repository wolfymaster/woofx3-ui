import { describe, expect, test } from "bun:test";
import {
  type GettingStartedFacts,
  gettingStartedItems,
  gettingStartedProgress,
  VISIBLE_ITEM_COUNT,
} from "./getting-started";

const twitch = { marketplaceModuleId: "woofx3_twitch", name: "Twitch", approvedPermissions: [] };
const obs = { marketplaceModuleId: "woofx3_obs", name: "OBS", approvedPermissions: [] };

function facts(overrides: Partial<GettingStartedFacts> = {}, setup: Partial<GettingStartedFacts["setup"]> = {}) {
  const base: GettingStartedFacts = {
    setup: {
      platforms: [twitch],
      moduleInstalls: [{ marketplaceModuleId: "woofx3_twitch", status: "installed" }],
      twitchUsername: "streamer",
      engineRegistered: true,
      platformsNeedingSettings: [],
    },
    overlays: {
      hasScene: true,
      browserSourceKeyCount: 1,
      featuredUrl: "https://example.test/browser-source/k",
      lastLoadedAt: null,
    },
    doneItemIds: [],
    obsStatus: null,
    hasImport: false,
    hasStarterPack: false,
    installedModuleIds: [],
    pagePublished: false,
  };
  return { ...base, ...overrides, setup: { ...base.setup, ...setup } };
}

function byId(input: GettingStartedFacts) {
  return Object.fromEntries(gettingStartedItems(input).map((entry) => [entry.id, entry]));
}

describe("gettingStartedItems", () => {
  test("lists the post-onboarding items for a fresh account, with no problem items", () => {
    const ids = gettingStartedItems(facts()).map((entry) => entry.id);
    expect(ids).toEqual([
      "overlay",
      "test-alert",
      "alerts",
      "import",
      "starter-packs",
      "optional-platforms",
      "your-page",
    ]);
  });

  test("is all done once everything was done or dismissed", () => {
    const items = gettingStartedItems(
      facts({
        doneItemIds: ["overlay", "test-alert", "alerts", "dismissed:import", "dismissed:your-page"],
        hasStarterPack: true,
        installedModuleIds: ["woofx3_obs"],
      })
    );
    expect(items.every((entry) => entry.status === "done")).toBe(true);
    expect(gettingStartedProgress(items).done).toBe(gettingStartedProgress(items).total);
  });

  test("leaves a dismissed optional item out", () => {
    const items = byId(facts({ doneItemIds: ["dismissed:import", "dismissed:starter-packs"] }));
    expect(items.import).toBeUndefined();
    expect(items["starter-packs"]).toBeUndefined();
    expect(items["your-page"].actions).toEqual([{ kind: "dismiss-item", label: "Not for me", itemId: "your-page" }]);
  });

  test("shows a problem before anything to do, and done items last", () => {
    const items = gettingStartedItems(facts({ doneItemIds: ["overlay"] }, { twitchUsername: null }));
    expect(items[0].id).toBe("twitch");
    expect(items[0].status).toBe("problem");
    expect(items[items.length - 1].id).toBe("overlay");
    expect(items.slice(0, VISIBLE_ITEM_COUNT).some((entry) => entry.status === "done")).toBe(false);
  });

  test("has no item for twitch or platforms unless something is wrong", () => {
    const items = byId(facts());
    expect(items.twitch).toBeUndefined();
    expect(items.platforms).toBeUndefined();
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
    expect(item.fixes).toEqual([
      { kind: "route", label: "Review Twitch", href: "/marketplace/installed/woofx3_twitch" },
    ]);
  });

  test("sends Twitch back to the connect page when it is not linked", () => {
    const item = byId(facts({}, { twitchUsername: null })).twitch;
    expect(item.fixes).toEqual([{ kind: "route", label: "Connect Twitch", href: "/setup/connect" }]);
  });

  test("offers the overlay link and the overlay page until the page recorded the overlay", () => {
    const item = byId(facts()).overlay;
    expect(item.status).toBe("todo");
    expect(item.fixes).toEqual([
      { kind: "copy", label: "Copy link", text: "https://example.test/browser-source/k" },
      { kind: "route", label: "Show me how", href: "/setup/overlay" },
    ]);
  });

  test("counts the overlay done once recorded, or once a browser source loaded it", () => {
    expect(byId(facts({ doneItemIds: ["overlay"] })).overlay.status).toBe("done");
    expect(
      byId(
        facts({
          overlays: { hasScene: true, browserSourceKeyCount: 1, featuredUrl: null, lastLoadedAt: 5 },
        })
      ).overlay.status
    ).toBe("done");
  });

  test("still offers the overlay page when there is no link to copy yet", () => {
    const item = byId(
      facts({ overlays: { hasScene: false, browserSourceKeyCount: 0, featuredUrl: null, lastLoadedAt: null } })
    ).overlay;
    expect(item.fixes).toEqual([{ kind: "route", label: "Show me how", href: "/setup/overlay" }]);
  });

  test("keeps the test alert to do until it is recorded", () => {
    expect(byId(facts())["test-alert"].actions).toEqual([{ kind: "fire-test-alert", label: "Send a test alert" }]);
    expect(byId(facts({ doneItemIds: ["test-alert"] }))["test-alert"].status).toBe("done");
  });

  test("finishes the optional items from what exists", () => {
    const items = byId(
      facts({ hasImport: true, hasStarterPack: true, installedModuleIds: ["woofx3_spotify"], pagePublished: true })
    );
    expect(items.import.status).toBe("done");
    expect(items["starter-packs"].status).toBe("done");
    expect(items["optional-platforms"].status).toBe("done");
    expect(items["your-page"].status).toBe("done");
  });

  test("asks for the settings of a platform that declares them until marked done", () => {
    const spotify = { marketplaceModuleId: "woofx3_spotify", name: "Spotify", approvedPermissions: [] };
    const setup = { platforms: [twitch, spotify], platformsNeedingSettings: ["woofx3_spotify"] };
    const todo = byId(facts({}, setup))["platform-settings:woofx3_spotify"];
    expect(todo.status).toBe("todo");
    expect(todo.fixes).toEqual([
      { kind: "route", label: "Open Spotify", href: "/marketplace/installed/woofx3_spotify" },
    ]);
    expect(todo.actions).toEqual([
      { kind: "mark-platform-settings-done", label: "Done", marketplaceModuleId: "woofx3_spotify" },
    ]);

    const done = byId(facts({ doneItemIds: ["platform-settings:woofx3_spotify"] }, setup))[
      "platform-settings:woofx3_spotify"
    ];
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
    expect(refused.fixes).toEqual([{ kind: "route", label: "Open OBS", href: "/marketplace/installed/woofx3_obs" }]);
  });

  test("keeps the Done button for OBS when the engine cannot report its connection", () => {
    const setup = { platforms: [twitch, obs], platformsNeedingSettings: ["woofx3_obs"] };
    const item = byId(facts({ doneItemIds: [] }, setup))["platform-settings:woofx3_obs"];
    expect(item.actions.map((action) => action.kind)).toEqual(["mark-platform-settings-done"]);
  });
});
