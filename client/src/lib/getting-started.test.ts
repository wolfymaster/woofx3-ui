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
    overlayFinished: false,
    overlaySeeded: true,
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
        overlayFinished: true,
        doneItemIds: ["alerts", "dismissed:import", "dismissed:your-page"],
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
    const items = gettingStartedItems(facts({ overlayFinished: true }, { twitchUsername: null }));
    expect(items[0].id).toBe("twitch");
    expect(items[0].status).toBe("problem");
    expect(items[items.length - 1].status).toBe("done");
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

  test("offers the overlay link and the overlay page until a test finished", () => {
    const item = byId(facts()).overlay;
    expect(item.status).toBe("todo");
    expect(item.actions).toEqual([{ kind: "copy-overlay-link", label: "Copy link" }]);
    expect(item.fixes).toEqual([{ kind: "route", label: "Show me how", href: "/setup/overlay" }]);
  });

  test("counts the overlay and the test alert done once the overlay page finished", () => {
    const items = byId(facts({ overlayFinished: true }));
    expect(items.overlay.status).toBe("done");
    expect(items["test-alert"].status).toBe("done");
  });

  test("sends the test alert to the overlay page, where it can be matched to its alert", () => {
    const item = byId(facts())["test-alert"];
    expect(item.actions).toEqual([]);
    expect(item.fixes).toEqual([{ kind: "route", label: "Send a test alert", href: "/setup/overlay" }]);
  });

  test("leaves out the overlay items for an instance that was never seeded", () => {
    const items = byId(facts({ overlaySeeded: false }));
    expect(items.overlay).toBeUndefined();
    expect(items["test-alert"]).toBeUndefined();
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

  test("puts the overlay above per-platform settings, unless a platform has a real problem", () => {
    const spotify = { marketplaceModuleId: "woofx3_spotify", name: "Spotify Platform", approvedPermissions: [] };
    const setup = { platforms: [twitch, spotify, obs], platformsNeedingSettings: ["woofx3_spotify", "woofx3_obs"] };
    const todo = gettingStartedItems(facts({}, setup));
    expect(todo.slice(0, 3).map((entry) => entry.id)).toEqual([
      "overlay",
      "test-alert",
      "platform-settings:woofx3_spotify",
    ]);
    const obsRefused = facts(
      { obsStatus: { state: "retrying", failure: "authentication", address: "obs.lan:4455" } },
      setup
    );
    expect(gettingStartedItems(obsRefused)[0]?.id).toBe("platform-settings:woofx3_obs");
  });

  test("drops the word Platform from a module's name", () => {
    const spotify = { marketplaceModuleId: "woofx3_spotify", name: "Spotify Platform", approvedPermissions: [] };
    const setup = { platforms: [spotify], platformsNeedingSettings: ["woofx3_spotify"] };
    expect(byId(facts({}, setup))["platform-settings:woofx3_spotify"].title).toBe("Set up Spotify");
  });

  test("never asks to set up Twitch: connecting it is the setup", () => {
    const named = { ...twitch, name: "Twitch Platform" };
    const setup = { platforms: [named], platformsNeedingSettings: ["woofx3_twitch"] };
    expect(byId(facts({}, setup))["platform-settings:woofx3_twitch"]).toBeUndefined();
    const unlinked = byId(facts({}, { ...setup, twitchUsername: null }));
    expect(unlinked["platform-settings:woofx3_twitch"]).toBeUndefined();
    expect(unlinked.twitch?.status).toBe("problem");
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
