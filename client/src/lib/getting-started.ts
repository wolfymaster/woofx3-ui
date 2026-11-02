import type { ObsStatus } from "@convex/lib/engineObsStatus";
import { dismissedItemId, platformSettingsItemId } from "@convex/lib/gettingStarted";
import { TWITCH_SETUP_MODULE_ID } from "@convex/lib/setupPlatforms";
import type { SetupStatus } from "@convex/setup";
import { installedModulePath, MARKETPLACE_PATH } from "@/lib/marketplace-route";
import { describeObsStatus, OBS_MODULE_ID } from "@/lib/obs-status";
import { setupStepPath } from "@/lib/setup-steps";

// The dashboard's getting started checklist: what is left after onboarding,
// from getting the overlay into the streaming app to the optional extras.
// Pure, so which items are done and what each offers is testable without
// Convex or an engine.

export type GettingStartedItemId =
  | "twitch"
  | "platforms"
  | "overlay"
  | "test-alert"
  | "alerts"
  | "import"
  | "starter-packs"
  | "optional-platforms"
  | "your-page"
  | `platform-settings:${string}`;

export type GettingStartedStatus = "done" | "todo" | "problem";

/** Buttons the card handles itself, beyond links and copying. */
export type GettingStartedAction =
  | { kind: "retry-installs"; label: string }
  | { kind: "copy-overlay-link"; label: string }
  | { kind: "mark-alerts-done"; label: string }
  | { kind: "mark-platform-settings-done"; label: string; marketplaceModuleId: string }
  | { kind: "dismiss-item"; label: string; itemId: GettingStartedItemId };

/** A button on an item: go somewhere, or copy a value. */
export type CheckFix = { kind: "route"; label: string; href: string } | { kind: "copy"; label: string; text: string };

export interface GettingStartedItem {
  id: GettingStartedItemId;
  title: string;
  status: GettingStartedStatus;
  summary: string;
  fixes: CheckFix[];
  actions: GettingStartedAction[];
}

export interface GettingStartedFacts {
  setup: Pick<
    SetupStatus,
    "platforms" | "moduleInstalls" | "twitchUsername" | "engineRegistered" | "platformsNeedingSettings"
  >;
  /** Items the card recorded itself, and the optional ones dismissed; see convex/lib/gettingStarted.ts. */
  doneItemIds: readonly string[];
  /**
   * The engine's OBS connection, when it can report one. With it, setting up
   * OBS is done once OBS is connected rather than when the streamer says so.
   */
  obsStatus: ObsStatus | null;
  /**
   * Whether the overlay page recorded a finished test (an alert played, or the
   * streamer saw it play). Live presence is not used: it only exists while the
   * overlay page is open and polling.
   */
  overlayFinished: boolean;
  /** False for an instance set up before the default overlay existed: it has no overlay page to send anyone to. */
  overlaySeeded: boolean;
  /** Whether the instance has run an import. */
  hasImport: boolean;
  /** Whether any starter pack item is installed. */
  hasStarterPack: boolean;
  /** Ids of the modules installed on the engine. */
  installedModuleIds: readonly string[];
  /** Whether the instance's public page is live. */
  pagePublished: boolean;
}

/** Modules the optional platforms item offers; installing either finishes it. */
const OPTIONAL_PLATFORM_MODULE_IDS: readonly string[] = [OBS_MODULE_ID, "woofx3_spotify"];

export const OVERLAY_PAGE_PATH = "/setup/overlay";
const ALERTS_PATH = "/stream/alerts";
const STARTER_PACKS_PATH = "/stream/starter-packs";
const IMPORT_PATH = "/admin/backup";
const YOUR_PAGE_PATH = "/stream/page";

/** Items shown before "Show more". */
export const VISIBLE_ITEM_COUNT = 5;

function item(
  id: GettingStartedItemId,
  title: string,
  status: GettingStartedStatus,
  summary: string,
  extras: { fixes?: CheckFix[]; actions?: GettingStartedAction[] } = {}
): GettingStartedItem {
  return { id, title, status, summary, fixes: extras.fixes ?? [], actions: extras.actions ?? [] };
}

function dismissAction(itemId: GettingStartedItemId): GettingStartedAction {
  return { kind: "dismiss-item", label: "Not for me", itemId };
}

/** Shown only when something went wrong installing a platform. */
function platformsProblem(setup: GettingStartedFacts["setup"]): GettingStartedItem[] {
  const title = "Platforms installed";
  const installs = new Map(setup.moduleInstalls.map((entry) => [entry.marketplaceModuleId, entry]));
  const nameOf = (id: string) => setup.platforms.find((p) => p.marketplaceModuleId === id)?.name ?? id;

  const needsApproval = setup.platforms.filter(
    (platform) => installs.get(platform.marketplaceModuleId)?.status === "needs_approval"
  );
  if (needsApproval.length > 0) {
    return [
      item(
        "platforms",
        title,
        "problem",
        `${needsApproval.map((platform) => nameOf(platform.marketplaceModuleId)).join(", ")} now asks for more permissions`,
        {
          fixes: needsApproval.map((platform) => ({
            kind: "route" as const,
            label: `Review ${nameOf(platform.marketplaceModuleId)}`,
            href: installedModulePath(platform.marketplaceModuleId),
          })),
        }
      ),
    ];
  }
  const failed = setup.platforms.filter((platform) => installs.get(platform.marketplaceModuleId)?.status === "failed");
  if (failed.length > 0) {
    return [
      item(
        "platforms",
        title,
        "problem",
        `${failed.map((platform) => nameOf(platform.marketplaceModuleId)).join(", ")} did not install`,
        { actions: [{ kind: "retry-installs", label: "Retry" }] }
      ),
    ];
  }
  return [];
}

/**
 * One item per installed platform that needs its settings filled in, such as
 * an account to authorize. Its settings live on the engine, so the item is
 * done when the streamer says so. Twitch has none: connecting it is its setup,
 * which `twitchProblem` asks for while it is missing.
 */
function platformSettingsItems(
  setup: GettingStartedFacts["setup"],
  done: ReadonlySet<string>,
  obsStatus: ObsStatus | null
): GettingStartedItem[] {
  const needing = setup.platformsNeedingSettings.filter((id) => id !== TWITCH_SETUP_MODULE_ID);
  return needing.map((marketplaceModuleId) => {
    const listed = setup.platforms.find((p) => p.marketplaceModuleId === marketplaceModuleId)?.name;
    const name = listed?.replace(/ Platform$/, "") ?? marketplaceModuleId;
    const id = platformSettingsItemId(marketplaceModuleId) as GettingStartedItemId;
    if (marketplaceModuleId === OBS_MODULE_ID && obsStatus !== null) {
      return obsSettingsItem(id, name, obsStatus);
    }
    if (done.has(id)) {
      return item(id, `Set up ${name}`, "done", `${name} is set up`);
    }
    return item(id, `Set up ${name}`, "todo", `${name} needs a few settings before it works, such as your account`, {
      fixes: [{ kind: "route", label: `Open ${name}`, href: installedModulePath(marketplaceModuleId) }],
      actions: [{ kind: "mark-platform-settings-done", label: "Done", marketplaceModuleId }],
    });
  });
}

/** OBS's settings item when the engine reports its connection: done once connected. */
function obsSettingsItem(id: GettingStartedItemId, name: string, status: ObsStatus): GettingStartedItem {
  const description = describeObsStatus(status);
  if (description.tone === "ok") {
    return item(id, `Set up ${name}`, "done", description.text);
  }
  return item(id, `Set up ${name}`, description.tone === "problem" ? "problem" : "todo", description.text, {
    fixes: [{ kind: "route", label: `Open ${name}`, href: installedModulePath(OBS_MODULE_ID) }],
  });
}

/** Shown only while Twitch is not connected. */
function twitchProblem(setup: GettingStartedFacts["setup"]): GettingStartedItem[] {
  if (setup.twitchUsername !== null) {
    return [];
  }
  return [
    item("twitch", "Connect Twitch", "problem", "Twitch isn't connected", {
      fixes: [{ kind: "route", label: "Connect Twitch", href: setupStepPath("connect") }],
    }),
  ];
}

function overlayItem(finished: boolean): GettingStartedItem {
  const title = "Add your overlay to your streaming app";
  if (finished) {
    return item("overlay", title, "done", "Your overlay is working", {
      fixes: [{ kind: "route", label: "Open your overlay", href: OVERLAY_PAGE_PATH }],
      actions: [{ kind: "copy-overlay-link", label: "Copy link" }],
    });
  }
  return item("overlay", title, "todo", "Alerts only show on stream once your streaming app has your overlay", {
    fixes: [{ kind: "route", label: "Show me how", href: OVERLAY_PAGE_PATH }],
    actions: [{ kind: "copy-overlay-link", label: "Copy link" }],
  });
}

function testAlertItem(finished: boolean): GettingStartedItem {
  const title = "Send a test alert";
  if (finished) {
    return item("test-alert", title, "done", "You've seen a test alert");
  }
  return item("test-alert", title, "todo", "See an alert the way your viewers will", {
    fixes: [{ kind: "route", label: "Send a test alert", href: OVERLAY_PAGE_PATH }],
  });
}

function alertsItem(done: boolean): GettingStartedItem {
  const title = "Make the alerts yours";
  if (done) {
    return item("alerts", title, "done", "You've had a look at your alerts");
  }
  return item("alerts", title, "todo", "Change the look, sound and message of your alerts", {
    fixes: [{ kind: "route", label: "Open alerts", href: ALERTS_PATH }],
    actions: [{ kind: "mark-alerts-done", label: "Done" }],
  });
}

function importItem(done: boolean): GettingStartedItem {
  const title = "Bring your setup from Firebot or Streamer.bot";
  if (done) {
    return item("import", title, "done", "You've brought your setup over");
  }
  return item("import", title, "todo", "Move your commands and alerts across instead of starting again", {
    fixes: [{ kind: "route", label: "Import", href: IMPORT_PATH }],
    actions: [dismissAction("import")],
  });
}

function starterPacksItem(done: boolean): GettingStartedItem {
  const title = "Add chat commands and thank-yous";
  if (done) {
    return item("starter-packs", title, "done", "You've added ready-made commands");
  }
  return item("starter-packs", title, "todo", "Pick ready-made commands and thank-yous to start with", {
    fixes: [{ kind: "route", label: "Browse starter packs", href: STARTER_PACKS_PATH }],
    actions: [dismissAction("starter-packs")],
  });
}

function optionalPlatformsItem(done: boolean): GettingStartedItem {
  const title = "Using OBS scenes or Spotify? Connect them";
  if (done) {
    return item("optional-platforms", title, "done", "You've added a platform");
  }
  return item("optional-platforms", title, "todo", "Add OBS scene control or Spotify song requests", {
    fixes: [{ kind: "route", label: "Open the marketplace", href: MARKETPLACE_PATH }],
    actions: [dismissAction("optional-platforms")],
  });
}

function yourPageItem(done: boolean): GettingStartedItem {
  const title = "Publish your page";
  if (done) {
    return item("your-page", title, "done", "Your page is live");
  }
  return item("your-page", title, "todo", "Give viewers a page of their own at woofx3.tv", {
    fixes: [{ kind: "route", label: "Your page", href: YOUR_PAGE_PATH }],
    actions: [dismissAction("your-page")],
  });
}

const STATUS_ORDER: Record<GettingStartedStatus, number> = { problem: 0, todo: 1, done: 2 };

/** The overlay item stays with what is left once done: it is how a streamer gets back to the link. */
function rankOf(entry: GettingStartedItem): number {
  return entry.id === "overlay" ? STATUS_ORDER.todo : STATUS_ORDER[entry.status];
}

/**
 * The card's items: problems first, then what is left with the overlay leading,
 * then what is done, so the first few are the ones that matter. Dismissed
 * optional items are left out.
 */
export function gettingStartedItems(facts: GettingStartedFacts): GettingStartedItem[] {
  const done = new Set(facts.doneItemIds);
  const dismissed = (id: GettingStartedItemId) => done.has(dismissedItemId(id));
  const items = [
    ...twitchProblem(facts.setup),
    ...platformsProblem(facts.setup),
    ...(facts.overlaySeeded ? [overlayItem(facts.overlayFinished), testAlertItem(facts.overlayFinished)] : []),
    ...platformSettingsItems(facts.setup, done, facts.obsStatus),
    alertsItem(done.has("alerts")),
    importItem(facts.hasImport),
    starterPacksItem(facts.hasStarterPack),
    optionalPlatformsItem(facts.installedModuleIds.some((id) => OPTIONAL_PLATFORM_MODULE_IDS.includes(id))),
    yourPageItem(facts.pagePublished),
  ].filter((entry) => entry.status === "done" || !dismissed(entry.id));
  return items.sort((a, b) => rankOf(a) - rankOf(b));
}

export function gettingStartedProgress(items: readonly GettingStartedItem[]): { done: number; total: number } {
  return { done: items.filter((entry) => entry.status === "done").length, total: items.length };
}
