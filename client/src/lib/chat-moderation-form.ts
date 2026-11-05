import {
  DEFAULT_ACTIONS,
  DEFAULT_FILTER_PARAMS,
  FILTER_IDS,
  type FilterId,
  MODERATION_ACTION_KINDS,
  type ModerationAction,
  type ModerationActionKind,
  type ModerationConfig,
  type ModerationRule,
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

/** Why the config cannot be saved, by the engine's own parser, or null. */
export function configProblem(config: ModerationConfig): string | null {
  const parsed = parseModerationConfig(config);
  return parsed.ok ? null : parsed.error;
}

/** Names typed one per line or separated by commas, as the config keeps them. */
export function parseNameList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}
