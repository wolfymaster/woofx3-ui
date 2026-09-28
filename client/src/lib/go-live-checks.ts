import {
  GO_LIVE_CHECK_IDS,
  type GoLiveCheckId,
  type LastGoLive,
  type ObsFacts,
  type OverlayFacts,
  type StreamInfoFacts,
  type TwitchLinkFacts,
} from "@convex/lib/goLiveFacts";
import { formatTimeAgo } from "@/lib/time-ago";

// The Go live checklist's rules: what each fact the checks gather means for
// the stream, and what the streamer can do about it. Pure, so every
// pass/warn/fail decision is testable without Convex, Twitch or an engine.
//
// "fail" is kept for things that will visibly break the stream (no engine, no
// Twitch, no overlay URL at all). Anything the checklist cannot confirm, or
// that is merely worth a second look, is a "warn".

export type CheckStatus = "running" | "pass" | "warn" | "fail";

export type CheckFix =
  | { kind: "route"; label: string; href: string }
  | { kind: "external"; label: string; href: string }
  | { kind: "copy"; label: string; text: string }
  | { kind: "retry"; label: string };

export interface CheckResult {
  id: GoLiveCheckId;
  title: string;
  status: CheckStatus;
  summary: string;
  /** Extra lines under the summary: the values checked, or each thing worth a look. */
  details: string[];
  fixes: CheckFix[];
}

export const GO_LIVE_CHECK_TITLES: Record<GoLiveCheckId, string> = {
  engine: "Engine",
  twitch: "Twitch connection",
  overlays: "Overlays",
  obs: "OBS",
  "stream-info": "Stream info",
  workflows: "Workflows",
};

/** A category left unchanged for longer than this is probably last stream's. */
export const STALE_CATEGORY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A go-live completed this recently is taken to be the current stream's own,
 * so running the checklist again mid-stream does not flag the title it just set.
 */
export const SAME_STREAM_WINDOW_MS = 6 * 60 * 60 * 1000;

const ENGINE_SETTINGS_PATH = "/admin/engine";
const INTEGRATIONS_PATH = "/admin/integrations";
const SCENES_PATH = "/stream/scenes";
const WORKFLOWS_PATH = "/stream/workflows";
const STARTER_PACKS_PATH = "/stream/starter-packs";

const RETRY: CheckFix = { kind: "retry", label: "Check again" };
const RECONNECT_TWITCH: CheckFix = { kind: "route", label: "Reconnect Twitch", href: INTEGRATIONS_PATH };

function result(
  id: GoLiveCheckId,
  status: CheckStatus,
  summary: string,
  extras: { details?: string[]; fixes?: CheckFix[] } = {}
): CheckResult {
  return {
    id,
    title: GO_LIVE_CHECK_TITLES[id],
    status,
    summary,
    details: extras.details ?? [],
    fixes: extras.fixes ?? [],
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function runningCheck(id: GoLiveCheckId): CheckResult {
  return result(id, "running", "Checking...");
}

/** A check whose question could not be asked. Not proof of a broken setup, so a warning. */
export function erroredCheck(id: GoLiveCheckId, message: string): CheckResult {
  return result(id, "warn", `Couldn't run this check: ${message}`, { fixes: [RETRY] });
}

export function engineCheck(connected: boolean): CheckResult {
  if (connected) {
    return result("engine", "pass", "The dashboard is connected to your engine");
  }
  return result("engine", "fail", "The dashboard can't reach your engine, so alerts and commands won't run", {
    fixes: [{ kind: "route", label: "Open engine settings", href: ENGINE_SETTINGS_PATH }],
  });
}

export function twitchCheck(facts: TwitchLinkFacts): CheckResult {
  if (!facts.linked) {
    return result("twitch", "fail", "Twitch isn't connected", {
      fixes: [{ kind: "route", label: "Connect Twitch", href: INTEGRATIONS_PATH }],
    });
  }
  if (!facts.tokenValid) {
    return result(
      "twitch",
      "fail",
      `${facts.tokenProblem ?? "The Twitch connection has expired"}. Reconnect to fix it.`,
      {
        fixes: [RECONNECT_TWITCH],
      }
    );
  }
  if (facts.missingScopes.length > 0) {
    return result(
      "twitch",
      "warn",
      `Connected as ${facts.login}, but missing ${plural(facts.missingScopes.length, "permission", "permissions")} newer features use`,
      { details: facts.missingScopes, fixes: [RECONNECT_TWITCH] }
    );
  }
  return result("twitch", "pass", `Connected as ${facts.login}`);
}

/**
 * Nothing reports whether an overlay is open in OBS right now, so the best
 * this can confirm is that one exists to open. A browser source loading its
 * URL is recorded, which says the URL has worked, not that it is loaded now.
 */
export function overlaysCheck(facts: OverlayFacts, browserSourceUrl: string | null, now: number): CheckResult {
  if (facts.sceneCount === 0) {
    return result("overlays", "fail", "There are no scenes yet, so OBS has no overlay to show", {
      fixes: [{ kind: "route", label: "Create a scene", href: SCENES_PATH }],
    });
  }
  if (facts.browserSourceKeyCount === 0) {
    return result("overlays", "fail", "No scene has a browser-source URL for OBS yet", {
      fixes: [{ kind: "route", label: "Get a browser-source URL", href: SCENES_PATH }],
    });
  }

  const lastLoaded =
    facts.lastLoadedAt === null
      ? "No browser source has loaded an overlay URL yet."
      : `A browser source last loaded an overlay ${formatTimeAgo(new Date(facts.lastLoadedAt).toISOString(), now)}.`;
  const fixes: CheckFix[] = [];
  if (browserSourceUrl) {
    fixes.push({ kind: "copy", label: "Copy browser-source URL", text: browserSourceUrl });
  }
  fixes.push({ kind: "route", label: "Open scenes", href: SCENES_PATH });
  return result("overlays", "warn", "Can't verify an overlay is loaded in OBS right now", {
    details: [lastLoaded],
    fixes,
  });
}

export function obsCheck(facts: ObsFacts): CheckResult {
  switch (facts.kind) {
    case "connected": {
      return result("obs", "pass", `OBS is connected (${plural(facts.sceneCount, "scene", "scenes")})`);
    }
    case "disconnected": {
      return result("obs", "warn", "OBS isn't connected. The scene manager keeps retrying in the background.", {
        details: [facts.reason],
        fixes: [RETRY],
      });
    }
    case "engine-update-needed": {
      return result("obs", "warn", "Your engine is too old to report OBS status. Update it to check OBS from here.");
    }
    case "engine-unreachable": {
      return result("obs", "warn", "Couldn't ask the engine about OBS", { details: [facts.message], fixes: [RETRY] });
    }
  }
}

export function streamInfoCheck(facts: StreamInfoFacts, lastGoLive: LastGoLive | null, now: number): CheckResult {
  if (facts.kind === "unlinked") {
    return result("stream-info", "fail", "Connect Twitch to check your title and category", {
      fixes: [{ kind: "route", label: "Connect Twitch", href: INTEGRATIONS_PATH }],
    });
  }

  const concerns: string[] = [];
  if (!facts.title.trim()) {
    concerns.push("There is no stream title.");
  }
  if (!facts.categoryId) {
    concerns.push("There is no category, so the stream won't show up in any directory.");
  }
  if (lastGoLive && now - lastGoLive.completedAt > SAME_STREAM_WINDOW_MS) {
    if (lastGoLive.title !== null && facts.title.trim() !== "" && lastGoLive.title === facts.title) {
      concerns.push(`Same title as your last go-live on ${formatDate(lastGoLive.completedAt)}.`);
    }
    const sameCategory =
      lastGoLive.categoryId !== null && facts.categoryId !== "" && lastGoLive.categoryId === facts.categoryId;
    if (sameCategory && now - lastGoLive.completedAt > STALE_CATEGORY_MS) {
      concerns.push(`Category unchanged since your last go-live on ${formatDate(lastGoLive.completedAt)}.`);
    }
  }

  const current = [
    `Title: ${facts.title.trim() || "(none)"}`,
    `Category: ${facts.categoryName || "(none)"}`,
    `Tags: ${facts.tags.length > 0 ? facts.tags.join(", ") : "(none)"}`,
  ];
  const fixes: CheckFix[] = [
    { kind: "external", label: "Edit on Twitch", href: `https://dashboard.twitch.tv/u/${facts.login}/stream-manager` },
  ];

  if (concerns.length > 0) {
    return result("stream-info", "warn", concerns[0], { details: [...concerns.slice(1), ...current], fixes });
  }
  return result("stream-info", "pass", facts.title.trim(), { details: current.slice(1), fixes });
}

export function workflowsCheck(counts: { total: number; enabled: number }): CheckResult {
  if (counts.enabled === 0) {
    const summary =
      counts.total === 0
        ? "You have no workflows, so nothing will react to follows, subs or raids"
        : "None of your workflows are turned on, so nothing will react to follows, subs or raids";
    return result("workflows", "warn", summary, {
      fixes: [
        { kind: "route", label: "Browse starter packs", href: STARTER_PACKS_PATH },
        { kind: "route", label: "Open workflows", href: WORKFLOWS_PATH },
      ],
    });
  }
  return result("workflows", "pass", `${plural(counts.enabled, "workflow is", "workflows are")} turned on`);
}

export type ChecklistOverall = CheckStatus;

export interface ChecklistSummary {
  overall: ChecklistOverall;
  /** Checks still shown, in checklist order. */
  active: CheckResult[];
  /** Checks the streamer set aside, in checklist order. They never affect `overall`. */
  dismissed: CheckResult[];
  counts: Record<CheckStatus, number>;
}

/**
 * Rolls the individual results up into one verdict. Worst status wins, and a
 * check still running holds the verdict at "running" rather than letting an
 * early pass read as all-clear.
 */
export function summarizeChecklist(results: CheckResult[], dismissedIds: readonly string[]): ChecklistSummary {
  const dismissedSet = new Set(dismissedIds);
  const ordered = [...results].sort((a, b) => GO_LIVE_CHECK_IDS.indexOf(a.id) - GO_LIVE_CHECK_IDS.indexOf(b.id));
  const active = ordered.filter((check) => !dismissedSet.has(check.id));
  const dismissed = ordered.filter((check) => dismissedSet.has(check.id));

  const counts: Record<CheckStatus, number> = { running: 0, pass: 0, warn: 0, fail: 0 };
  for (const check of active) {
    counts[check.status] += 1;
  }

  let overall: ChecklistOverall = "pass";
  if (counts.running > 0) {
    overall = "running";
  } else if (counts.fail > 0) {
    overall = "fail";
  } else if (counts.warn > 0) {
    overall = "warn";
  }
  return { overall, active, dismissed, counts };
}
