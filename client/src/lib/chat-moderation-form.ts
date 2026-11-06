import {
  DEFAULT_ACTIONS,
  DEFAULT_FILTER_PARAMS,
  FILTER_IDS,
  type FilterId,
  isFilterId,
  MODERATION_ACTION_KINDS,
  type ModerationAction,
  type ModerationActionKind,
  type ModerationConfig,
  type ModerationRule,
  type ModerationStepOutcome,
  parseModerationConfig,
} from "@woofx3/api/moderation-config";
import { parsePattern } from "@woofx3/api/moderation-pattern";

/** Where the chat moderation page lives. */
export const MODERATION_PATH = "/stream/moderation";

/** How each filter is named and explained on the moderation page, in evaluation order. */
export const FILTER_COPY: Record<FilterId, { title: string; description: string }> = {
  banned_phrases: {
    title: "Banned phrases",
    description: "Catches words and phrases you never want in your chat.",
  },
  links: {
    title: "Links",
    description: "Catches links to websites you have not allowed.",
  },
  repetition: {
    title: "Repeated messages",
    description: "Catches a viewer sending the same message over and over.",
  },
  caps: {
    title: "Capital letters",
    description: "Catches messages that are mostly in capitals. Short messages like LOL are left alone.",
  },
  symbols: {
    title: "Symbols",
    description: "Catches messages that are mostly punctuation and symbols. Emoji do not count.",
  },
};

export const FILTER_ORDER: readonly FilterId[] = FILTER_IDS;

/** What a new warning says to the viewer until the streamer writes their own. */
export const DEFAULT_WARN_REASON = "Please follow the chat rules.";

/** Ten minutes: long enough to cool off, short enough to forgive. */
export const DEFAULT_TIMEOUT_SECONDS = 600;

/** The timeout lengths the page offers, in seconds. */
export const TIMEOUT_CHOICES: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 60, label: "1 minute" },
  { seconds: 600, label: "10 minutes" },
  { seconds: 3_600, label: "1 hour" },
  { seconds: 86_400, label: "1 day" },
  { seconds: 604_800, label: "1 week" },
  { seconds: 1_209_600, label: "2 weeks" },
];

/** The filter's rule, or a switched-off delete-only rule with default settings when it has none yet. */
export function ruleOf(config: ModerationConfig, filter: FilterId): ModerationRule {
  return (
    config.rules[filter] ?? { enabled: false, actions: [...DEFAULT_ACTIONS], params: DEFAULT_FILTER_PARAMS[filter] }
  );
}

export function withRule(config: ModerationConfig, filter: FilterId, rule: ModerationRule): ModerationConfig {
  return { ...config, rules: { ...config.rules, [filter]: rule } };
}

/**
 * `actions` with `kind` switched on or off, in the order they run. Timeout and
 * ban exclude each other, so turning one on turns the other off. A rule keeps
 * at least one action: switching off the last one does nothing.
 */
export function toggleAction(
  actions: readonly ModerationAction[],
  kind: ModerationActionKind,
  on: boolean
): ModerationAction[] {
  if (!on) {
    const rest = actions.filter((action) => action.kind !== kind);
    return rest.length === 0 ? [...actions] : rest;
  }
  if (actions.some((action) => action.kind === kind)) {
    return [...actions];
  }
  const excluded: ModerationActionKind | null = kind === "timeout" ? "ban" : kind === "ban" ? "timeout" : null;
  const next = actions.filter((action) => action.kind !== excluded);
  next.push(newAction(kind));
  return next.sort((a, b) => MODERATION_ACTION_KINDS.indexOf(a.kind) - MODERATION_ACTION_KINDS.indexOf(b.kind));
}

function newAction(kind: ModerationActionKind): ModerationAction {
  switch (kind) {
    case "delete":
    case "ban": {
      return { kind };
    }
    case "warn": {
      return { kind, reason: DEFAULT_WARN_REASON };
    }
    case "timeout": {
      return { kind, durationSeconds: DEFAULT_TIMEOUT_SECONDS };
    }
  }
}

/** Switching ban on asks first: a ban lasts until someone lifts it. */
export function needsBanConfirm(
  actions: readonly ModerationAction[],
  kind: ModerationActionKind,
  on: boolean
): boolean {
  return on && kind === "ban" && !actions.some((action) => action.kind === "ban");
}

/** Why a banned phrase cannot be saved, in the parser's words, or null. */
export function phraseProblem(pattern: string): string | null {
  const parsed = parsePattern(pattern);
  return parsed.ok ? null : `This phrase ${parsed.error}.`;
}

/** Whether the engine's own parser accepts the config, so Save may send it. */
export function canSaveConfig(config: ModerationConfig): boolean {
  return parseModerationConfig(config).ok;
}

/** The filter a parser error is about, from the `rules.<filter>` its path starts with. */
const RULE_PATH = /^rules\.([a-z_]+)/;

/**
 * What the page says above the filters when the config can't be saved, or
 * null. A banned phrase's problem is already shown beside the phrase, so the
 * page says nothing more while one is. Any other problem names the card it is
 * on in plain words: the parser's own message carries the config's paths.
 */
export function configProblem(config: ModerationConfig): string | null {
  const parsed = parseModerationConfig(config);
  if (parsed.ok) {
    return null;
  }
  const phrases = ruleOf(config, "banned_phrases");
  const phrasesParams = phrases.params as { phrases?: readonly { pattern: string }[] };
  if (phrases.enabled && (phrasesParams.phrases ?? []).some((phrase) => phraseProblem(phrase.pattern) !== null)) {
    return null;
  }
  const filter = RULE_PATH.exec(parsed.error)?.[1];
  const card = isFilterId(filter) ? FILTER_COPY[filter].title : "General";
  return `Something under ${card} can't be saved yet. Check those settings, then save again.`;
}

/** Names typed one per line or separated by commas, as the config keeps them. */
export function parseNameList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/**
 * The Twitch permission each action needs. Twitch is the only platform the
 * page knows a link for; each platform's own scopes would join this table.
 */
export const TWITCH_ACTION_SCOPES: Record<ModerationActionKind, string> = {
  delete: "moderator:manage:chat_messages",
  warn: "moderator:manage:warnings",
  timeout: "moderator:manage:banned_users",
  ban: "moderator:manage:banned_users",
};

/** What the streamer is told for an action the Twitch link cannot perform until they reconnect. */
export const RECONNECT_MESSAGES: Record<ModerationActionKind, string> = {
  delete: "Reconnect Twitch to let woofx3 remove messages.",
  warn: "Reconnect Twitch to enable warnings.",
  timeout: "Reconnect Twitch to let woofx3 time viewers out.",
  ban: "Reconnect Twitch to let woofx3 ban viewers.",
};

/** The actions of `actions` that the link's `granted` scopes do not cover, in run order. */
export function actionsMissingScope(
  actions: readonly ModerationAction[],
  granted: readonly string[]
): ModerationActionKind[] {
  return actions.filter((action) => !granted.includes(TWITCH_ACTION_SCOPES[action.kind])).map((action) => action.kind);
}

/** Every action some enabled rule takes that the link cannot perform, once each, in run order. */
export function configActionsMissingScope(
  config: ModerationConfig,
  granted: readonly string[]
): ModerationActionKind[] {
  const missing = new Set<ModerationActionKind>();
  for (const filter of FILTER_IDS) {
    const rule = config.rules[filter];
    if (rule?.enabled) {
      for (const kind of actionsMissingScope(rule.actions, granted)) {
        missing.add(kind);
      }
    }
  }
  return MODERATION_ACTION_KINDS.filter((kind) => missing.has(kind));
}

/** How each step's outcome reads in the recent actions table. */
export const OUTCOME_LABELS: Record<ModerationStepOutcome, string> = {
  done: "Done",
  unconfirmed: "Sent, not confirmed",
  "skipped:cooldown": "Skipped: warned moments ago",
  "skipped:dry_run": "Test mode",
  "skipped:protected": "Skipped: moderator, VIP or unknown role",
  "skipped:busy": "Skipped: Twitch was busy",
  "failed:invalid": "Not possible for this message",
  "failed:rate_limited": "Failed: Twitch was busy",
  "failed:forbidden": "Failed: reconnect Twitch",
  "failed:upstream": "Failed: Twitch did not answer",
  "failed:unsupported": "Not available on this platform",
  "failed:unavailable": "Failed: not connected",
};

export const ACTION_NAMES: Record<ModerationActionKind, string> = {
  delete: "Removed",
  warn: "Warned",
  timeout: "Timed out",
  ban: "Banned",
};
