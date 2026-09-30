import type { OverlayFacts } from "@convex/lib/goLiveFacts";
import type { SetupStatus } from "@convex/setup";
import type { CheckFix } from "@/lib/go-live-checks";

// The dashboard's getting started card: a short first-session list, from
// finishing setup to seeing woofx3 react to a follow. Pure, so which items are
// done and what each offers is testable without Convex or an engine.

export type GettingStartedItemId = "setup" | "platforms" | "twitch" | "overlay" | "test-follow" | "chat-command";

export type GettingStartedStatus = "done" | "todo" | "problem";

/** Buttons the card handles itself, beyond links and copying. */
export type GettingStartedAction =
  | { kind: "retry-installs"; label: string }
  | { kind: "fire-test-follow"; label: string }
  | { kind: "mark-command-done"; label: string };

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
    "platformsChosenAt" | "completedAt" | "platforms" | "moduleInstalls" | "twitchUsername" | "engineRegistered"
  >;
  overlays: OverlayFacts;
  /** The browser-source URL to offer for OBS, when there is one. */
  browserSourceUrl: string | null;
  /** Items the card recorded itself; see MANUAL_GETTING_STARTED_ITEM_IDS. */
  doneItemIds: readonly string[];
}

const SCENES_PATH = "/stream/scenes";
const COMMANDS_PATH = "/stream/commands";

function item(
  id: GettingStartedItemId,
  title: string,
  status: GettingStartedStatus,
  summary: string,
  extras: { fixes?: CheckFix[]; actions?: GettingStartedAction[] } = {}
): GettingStartedItem {
  return { id, title, status, summary, fixes: extras.fixes ?? [], actions: extras.actions ?? [] };
}

function setupItem(setup: GettingStartedFacts["setup"]): GettingStartedItem {
  if (setup.completedAt !== null) {
    return item("setup", "Finish setting up", "done", "Setup is finished");
  }
  return item("setup", "Finish setting up", "todo", "Pick what woofx3 should do and get a dashboard to start from", {
    fixes: [{ kind: "route", label: "Continue setup", href: "/setup" }],
  });
}

function platformsItem(setup: GettingStartedFacts["setup"]): GettingStartedItem {
  const title = "Platforms installed";
  if (setup.platformsChosenAt === null) {
    return item("platforms", title, "todo", "Choose the platforms woofx3 works with", {
      fixes: [{ kind: "route", label: "Choose platforms", href: "/setup/platforms" }],
    });
  }
  const installs = new Map(setup.moduleInstalls.map((entry) => [entry.marketplaceModuleId, entry]));
  const nameOf = (id: string) => setup.platforms.find((p) => p.marketplaceModuleId === id)?.name ?? id;

  const needsApproval = setup.platforms.filter(
    (platform) => installs.get(platform.marketplaceModuleId)?.status === "needs_approval"
  );
  if (needsApproval.length > 0) {
    return item(
      "platforms",
      title,
      "problem",
      `${needsApproval.map((platform) => nameOf(platform.marketplaceModuleId)).join(", ")} now asks for more permissions`,
      {
        fixes: needsApproval.map((platform) => ({
          kind: "route" as const,
          label: `Review ${nameOf(platform.marketplaceModuleId)}`,
          href: `/modules/${platform.marketplaceModuleId}`,
        })),
      }
    );
  }
  const failed = setup.platforms.filter((platform) => installs.get(platform.marketplaceModuleId)?.status === "failed");
  if (failed.length > 0) {
    return item(
      "platforms",
      title,
      "problem",
      `${failed.map((platform) => nameOf(platform.marketplaceModuleId)).join(", ")} did not install`,
      { actions: [{ kind: "retry-installs", label: "Retry" }] }
    );
  }
  const installed = setup.platforms.filter(
    (platform) => installs.get(platform.marketplaceModuleId)?.status === "installed"
  ).length;
  if (installed === setup.platforms.length) {
    return item("platforms", title, "done", `${installed} of ${setup.platforms.length} installed`);
  }
  return item(
    "platforms",
    title,
    "todo",
    setup.engineRegistered
      ? `Installing: ${installed} of ${setup.platforms.length} done`
      : "They install as soon as your engine is ready"
  );
}

function twitchItem(setup: GettingStartedFacts["setup"]): GettingStartedItem {
  if (setup.twitchUsername !== null) {
    return item("twitch", "Twitch connected", "done", `Connected as @${setup.twitchUsername}`);
  }
  return item("twitch", "Twitch connected", "problem", "Twitch isn't connected", {
    fixes: [{ kind: "route", label: "Connect Twitch", href: "/setup/twitch" }],
  });
}

function overlayItem(overlays: OverlayFacts, browserSourceUrl: string | null): GettingStartedItem {
  const title = "Overlay added to OBS";
  if (overlays.lastLoadedAt !== null) {
    return item("overlay", title, "done", "OBS has loaded your overlay");
  }
  if (!overlays.hasScene || overlays.browserSourceKeyCount === 0) {
    return item("overlay", title, "todo", "Create a scene, then add its browser-source URL to OBS", {
      fixes: [{ kind: "route", label: "Open scenes", href: SCENES_PATH }],
    });
  }
  const fixes: CheckFix[] = [];
  if (browserSourceUrl) {
    fixes.push({ kind: "copy", label: "Copy browser-source URL", text: browserSourceUrl });
  }
  fixes.push({ kind: "route", label: "Open scenes", href: SCENES_PATH });
  return item("overlay", title, "todo", "In OBS, add a Browser source and paste your scene's URL", { fixes });
}

function testFollowItem(done: boolean): GettingStartedItem {
  const title = "Fire a test follow";
  if (done) {
    return item("test-follow", title, "done", "Sent a test follow to your engine");
  }
  return item("test-follow", title, "todo", "See woofx3 react the way it will to a real follower", {
    actions: [{ kind: "fire-test-follow", label: "Send a test follow" }],
  });
}

function chatCommandItem(done: boolean): GettingStartedItem {
  const title = "Run your first chat command";
  if (done) {
    return item("chat-command", title, "done", "You've tried a chat command");
  }
  return item("chat-command", title, "todo", "Type one of your commands, like !lurk, in your Twitch chat", {
    fixes: [{ kind: "route", label: "See your commands", href: COMMANDS_PATH }],
    actions: [{ kind: "mark-command-done", label: "I've tried it" }],
  });
}

/** The card's items, in the order a new streamer is likely to do them. */
export function gettingStartedItems(facts: GettingStartedFacts): GettingStartedItem[] {
  const done = new Set(facts.doneItemIds);
  return [
    setupItem(facts.setup),
    platformsItem(facts.setup),
    twitchItem(facts.setup),
    overlayItem(facts.overlays, facts.browserSourceUrl),
    testFollowItem(done.has("test-follow")),
    chatCommandItem(done.has("chat-command")),
  ];
}

export function gettingStartedProgress(items: readonly GettingStartedItem[]): { done: number; total: number } {
  return { done: items.filter((entry) => entry.status === "done").length, total: items.length };
}
