import type { FieldOptionsReference } from "@convex/lib/fieldOptions";
import {
  GO_LIVE_CHECK_IDS,
  type GoLiveCheckId,
  type LastGoLive,
  type OverlayFacts,
  type StreamInfoFacts,
  type TwitchLinkFacts,
  type WorkflowFacts,
} from "@convex/lib/goLiveFacts";
import type { StreamInfo } from "@convex/lib/streamInfo";
import { parseFieldOptionsReply } from "@/lib/field-options";
import { comparePreset } from "@/lib/stream-info-edit";
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
  | { kind: "retry"; label: string }
  | { kind: "apply-preset"; label: string; presets: PresetChoice[] };

/** A saved stream info preset as the checklist offers it. */
export interface StreamInfoPresetOption {
  id: string;
  name: string;
  info: StreamInfo;
}

/** A preset that would change the channel, with what applying it changes. */
export interface PresetChoice {
  id: string;
  name: string;
  summary: string;
}

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
  if (!facts.hasScene) {
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

/**
 * The field whose options the OBS check asks for: the scene picker of the
 * OBS platform module's "Switch OBS scene" action. The check asks exactly as that
 * picker does, so it needs no OBS-specific engine call, and its answer is what
 * the streamer's workflows will meet: the scene list, or the scene manager's
 * reason for having none.
 */
export const OBS_SCENES_FIELD: FieldOptionsReference = {
  moduleId: "woofx3_obs",
  declaration: "action",
  declarationId: "obs.switch_scene",
  fieldId: "sceneName",
};

/**
 * How long the check waits for the scene list. Longer than the field's own
 * 5s request timeout plus the engine's retries while the scene manager boots,
 * so an answer the engine relays late still lands.
 */
export const OBS_CHECK_TIMEOUT_MS = 15_000;

export type ObsFacts =
  | { kind: "connected"; sceneCount: number }
  /** The scene manager answered with a reason instead of scenes, e.g. OBS is not connected. */
  | { kind: "disconnected"; reason: string }
  /** The engine has no OBS scene field to ask: the OBS module is missing or older, or the engine predates field references. */
  | { kind: "unsupported" }
  /** Nothing answered in time. */
  | { kind: "no-answer" }
  | { kind: "engine-unreachable"; message: string };

/** A transient event relaying the engine's reply to a field-options request. */
export interface FieldOptionsReplyEvent {
  status: "progress" | "success" | "error";
  message?: string;
  data?: unknown;
}

/**
 * Phrases in the engine's refusal to send the request that mean it has nothing
 * to send, rather than that it failed to: the OBS module or its scene field
 * is missing, or the engine still takes a request descriptor instead of a
 * field reference. Must match the errors of `dispatchFieldOptionsRequest` in
 * the engine's api/src/routes/field-options.ts and field-options-reference.ts.
 */
const UNSUPPORTED_DISPATCH_PATTERNS: readonly RegExp[] = [
  /is not installed/,
  /declares no /,
  /: no (top-level )?field /,
  /Unsupported descriptor kind/,
  /is not a function/,
];

/** NATS's answers when nobody replied: a timeout, or no subscriber on the subject at all. */
const NO_ANSWER_PATTERN = /time(d)?\s?out|no responders/i;

/** What a refused field-options dispatch says about OBS. */
export function obsFactsFromDispatchError(message: string): ObsFacts {
  if (UNSUPPORTED_DISPATCH_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: "unsupported" };
  }
  return { kind: "engine-unreachable", message };
}

/** What the engine's reply says about OBS, or null while it is only progress. */
export function obsFactsFromReply(event: FieldOptionsReplyEvent): ObsFacts | null {
  if (event.status === "progress") {
    return null;
  }
  if (event.status === "error") {
    const reason = event.message?.trim() || "The engine gave no reason";
    if (NO_ANSWER_PATTERN.test(reason)) {
      return { kind: "no-answer" };
    }
    return { kind: "disconnected", reason };
  }
  if (!Array.isArray(event.data)) {
    const { error } = parseFieldOptionsReply(event.data);
    if (error !== null) {
      return { kind: "disconnected", reason: error };
    }
    return { kind: "engine-unreachable", message: "The engine answered with something other than a scene list" };
  }
  return { kind: "connected", sceneCount: parseFieldOptionsReply(event.data).options.length };
}

export function obsCheck(facts: ObsFacts): CheckResult {
  switch (facts.kind) {
    case "connected": {
      return result("obs", "pass", `OBS connected — ${plural(facts.sceneCount, "scene", "scenes")}`);
    }
    case "disconnected": {
      return result("obs", "warn", facts.reason, { fixes: [RETRY] });
    }
    case "unsupported": {
      return result(
        "obs",
        "warn",
        "OBS status can't be checked from here. Install the OBS module, or update it and your engine."
      );
    }
    case "no-answer": {
      return result("obs", "warn", "OBS didn't answer. Check that the scene manager is running.", {
        fixes: [RETRY],
      });
    }
    case "engine-unreachable": {
      return result("obs", "warn", "Couldn't ask the engine about OBS", { details: [facts.message], fixes: [RETRY] });
    }
  }
}

/** The channel as the stream info check read it, in the shape presets are compared against. */
export function streamInfoFromFacts(facts: Extract<StreamInfoFacts, { kind: "ok" }>): StreamInfo {
  return {
    title: facts.title,
    category: facts.categoryId ? { id: facts.categoryId, name: facts.categoryName } : null,
    tags: facts.tags,
  };
}

/** Presets that would change something, in the order given. One already in place is left out. */
export function applicablePresets(current: StreamInfo, presets: readonly StreamInfoPresetOption[]): PresetChoice[] {
  const choices: PresetChoice[] = [];
  for (const preset of presets) {
    const comparison = comparePreset(current, preset.info);
    if (!comparison.active) {
      choices.push({ id: preset.id, name: preset.name, summary: comparison.summary });
    }
  }
  return choices;
}

export function streamInfoCheck(
  facts: StreamInfoFacts,
  lastGoLive: LastGoLive | null,
  now: number,
  presets: readonly StreamInfoPresetOption[] = []
): CheckResult {
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
  const fixes: CheckFix[] = [];
  const choices = applicablePresets(streamInfoFromFacts(facts), presets);
  if (choices.length > 0) {
    fixes.push({ kind: "apply-preset", label: "Apply preset", presets: choices });
  }
  fixes.push({
    kind: "external",
    label: "Edit on Twitch",
    href: `https://dashboard.twitch.tv/u/${facts.login}/stream-manager`,
  });

  if (concerns.length > 0) {
    return result("stream-info", "warn", concerns[0], { details: [...concerns.slice(1), ...current], fixes });
  }
  return result("stream-info", "pass", facts.title.trim(), { details: current.slice(1), fixes });
}

export function workflowsCheck(facts: WorkflowFacts): CheckResult {
  if (facts.enabled === 0) {
    const summary = facts.any
      ? "None of your workflows are turned on, so nothing will react to follows, subs or raids"
      : "You have no workflows, so nothing will react to follows, subs or raids";
    return result("workflows", "warn", summary, {
      fixes: [
        { kind: "route", label: "Browse starter packs", href: STARTER_PACKS_PATH },
        { kind: "route", label: "Open workflows", href: WORKFLOWS_PATH },
      ],
    });
  }
  if (facts.enabledCapped) {
    return result("workflows", "pass", `${facts.enabled}+ workflows are turned on`);
  }
  return result("workflows", "pass", `${plural(facts.enabled, "workflow is", "workflows are")} turned on`);
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
