import type { ActionStep, ConditionConfig, ConditionOperator, TaskDefinition, WorkflowDefinition } from "@woofx3/api";

/**
 * Starter packs: curated sets of workflows and chat commands a new streamer
 * installs in one go. Everything here is data plus the pure functions that turn
 * it into the exact engine shapes the workflow wizard and command editor send,
 * so the Convex install action and the browser preview agree on what gets made.
 *
 * Packs name actions by canonical ref (`{moduleId}:action:{manifestId}`) and
 * triggers by the event subject they bind to. Both are resolved against the
 * instance's catalog at install time, which is what supplies the handler type,
 * function id and `$ref` an engine task needs.
 */

/** Modules whose actions packs use, by id. */
export const STARTER_MODULES = {
  /** The engine's bundled module: chat replies and OBS. */
  engine: "woofx3",
  /** The Twitch platform module, which also provides every trigger the packs bind to. */
  twitch: "woofx3_twitch",
} as const;

/**
 * Canonical refs of the actions packs use. Platform actions come from the
 * platform's module rather than the engine, so a missing Twitch action means
 * the Twitch module is absent or older than the packs, while a missing
 * `woofx3` action means the engine is.
 */
export const STARTER_ACTION_REFS = {
  chatReply: "woofx3:action:chat.reply",
  switchScene: "woofx3:action:obs.switch_scene",
  shoutout: "woofx3_twitch:action:twitch.shoutout",
  clip: "woofx3_twitch:action:twitch.clip",
  marker: "woofx3_twitch:action:twitch.marker",
} as const;

export type StarterActionRef = (typeof STARTER_ACTION_REFS)[keyof typeof STARTER_ACTION_REFS];

/** Engine built-in command groups, by name. Must match BuiltInGroups in the engine's db/database/models. */
export type BuiltInGroupName = "moderator" | "broadcaster";

export type StarterFieldValue = string | number;
export type StarterFieldValues = Record<string, StarterFieldValue>;

export interface StarterPackField {
  id: string;
  label: string;
  description?: string;
  type: "text" | "number";
  defaultValue: StarterFieldValue;
  /** Bounds for a number field, inclusive. */
  min?: number;
  max?: number;
  /**
   * Longest a text field's value may be once its placeholders are filled in,
   * estimated with PLACEHOLDER_LENGTH_ESTIMATE per placeholder.
   */
  maxLength?: number;
  /** A text value used exactly as typed, spaces included, such as an OBS scene name. */
  exact?: boolean;
  /** An engine capability a number field needs for any value but its default. */
  requires?: StarterFeature;
}

/** Engine capabilities that the action catalog cannot show. */
export type StarterFeature = "delayWait";
export type StarterFeatures = Record<StarterFeature, boolean>;

/**
 * What the engine supports beyond its action catalog.
 *
 * Nothing reports whether an engine supports delay waits: a delay is a wait
 * task rather than a catalog action, and EngineInfo.version is an image tag
 * that no release with delays carries yet. An engine without them reads a
 * delay as an event wait for an empty event, which times out and fails the
 * run, so a raid welcome with a pause would lose its shoutout and marker on
 * every raid. Until an engine can say it has them, pauses stay off.
 */
export const STARTER_FEATURES: StarterFeatures = { delayWait: false };

/** Twitch display names are at most 25 characters, the longest thing a placeholder becomes in practice. */
export const PLACEHOLDER_LENGTH_ESTIMATE = 25;

/** Longest chat message Twitch accepts. */
const CHAT_MAX_LENGTH = 500;

/** Longest stream marker description Twitch accepts. */
const MARKER_MAX_LENGTH = 140;

/** A parameter or condition value: a literal, or the value of one of the pack's fields. */
export type StarterValue = string | number | boolean | { field: string };

export interface StarterActionStep {
  kind: "action";
  id: string;
  /** How the preview describes the step. */
  label: string;
  action: StarterActionRef;
  parameters: Record<string, StarterValue>;
}

/** A pause before the next step. A length of zero leaves the step out. */
export interface StarterDelayStep {
  kind: "delay";
  id: string;
  label: string;
  seconds: { field: string };
}

export type StarterStep = StarterActionStep | StarterDelayStep;

export interface StarterCondition {
  /** Path under `trigger.data`. */
  path: string;
  operator: ConditionOperator;
  value: StarterValue;
}

export interface StarterWorkflowItem {
  kind: "workflow";
  id: string;
  name: string;
  description: string;
  trigger: {
    /** The event subject the trigger binds to, e.g. `channel.raid`. */
    event: string;
    label: string;
    conditions?: StarterCondition[];
  };
  /** `{name}` placeholders the pack's text may use, and the engine expression each stands for. */
  tokens: Record<string, string>;
  steps: StarterStep[];
}

export interface StarterCommandItem {
  kind: "command";
  id: string;
  /** The command word, without the `!`. */
  command: string;
  description: string;
  cooldown: number;
  /** Built-in groups the command is limited to. Absent means anyone may run it. */
  restrictTo?: BuiltInGroupName[];
  steps: StarterActionStep[];
}

export type StarterItem = StarterWorkflowItem | StarterCommandItem;

export interface StarterPack {
  id: string;
  name: string;
  /** One or two sentences on why a streamer wants this. */
  why: string;
  /** Anything the streamer has to have in place for the pack to work once installed. */
  note?: string;
  fields: StarterPackField[];
  items: StarterItem[];
}

/**
 * What a chat command's actions can say about who ran it. Must match
 * ChatCommandEventData in the engine's cloudevents package.
 */
export const COMMAND_TOKENS: Record<string, string> = {
  user: "${trigger.data.chatter}",
};

const RAID_TOKENS = {
  raider: "${trigger.data.fromBroadcasterUserName}",
  viewers: "${trigger.data.viewers}",
};

const GIFT_TOKENS = {
  gifter: "${trigger.data.isAnonymous ? 'An anonymous gifter' : trigger.data.gifterName}",
  count: "${trigger.data.amount}",
};

export const STARTER_PACKS: readonly StarterPack[] = [
  {
    id: "raid-welcome",
    name: "Raid welcome",
    why: "A raid is the biggest wave of new viewers you get. Thank the raider by name, send your viewers their way with a shoutout, and mark the moment so you can find it in the VOD.",
    note: "Twitch allows one shoutout every 2 minutes; a raid inside that window still gets its thank-you and marker.",
    fields: [
      {
        id: "raidMessage",
        label: "Chat message",
        type: "text",
        maxLength: CHAT_MAX_LENGTH,
        defaultValue: "{raider} is raiding with {viewers} viewers! Welcome in, everyone!",
      },
      {
        id: "shoutoutDelaySeconds",
        label: "Pause before the shoutout (seconds)",
        description: "Gives raiders a moment to arrive before the shoutout card. 0 shouts out straight away.",
        type: "number",
        defaultValue: 0,
        min: 0,
        max: 60,
        requires: "delayWait",
      },
      {
        id: "raidMarker",
        label: "Stream marker note",
        type: "text",
        maxLength: MARKER_MAX_LENGTH,
        defaultValue: "Raid from {raider}",
      },
    ],
    items: [
      {
        kind: "workflow",
        id: "raid-welcome",
        name: "Raid welcome",
        description: "Thanks the raider in chat, shouts them out and marks the raid in the VOD.",
        trigger: { event: "channel.raid", label: "Someone raids you" },
        tokens: RAID_TOKENS,
        steps: [
          {
            kind: "action",
            id: "thank-raider",
            label: "Thank the raider in chat",
            action: STARTER_ACTION_REFS.chatReply,
            parameters: { message: { field: "raidMessage" } },
          },
          { kind: "delay", id: "let-raiders-arrive", label: "Pause", seconds: { field: "shoutoutDelaySeconds" } },
          // skipIfRateLimited keeps a raid inside Twitch's shoutout window from
          // failing the run before the marker. Twitch module 0.7.0's shoutout
          // has no such input and ships no twitch.marker; missingRequirements
          // holds this item back on either, so it never runs on that module.
          {
            kind: "action",
            id: "shout-out-raider",
            label: "Shout out the raider",
            action: STARTER_ACTION_REFS.shoutout,
            parameters: { user: "${trigger.data.fromBroadcasterUserId}", skipIfRateLimited: true },
          },
          {
            kind: "action",
            id: "mark-raid",
            label: "Place a stream marker",
            action: STARTER_ACTION_REFS.marker,
            parameters: { description: { field: "raidMarker" } },
          },
        ],
      },
    ],
  },
  {
    id: "follower-thanks",
    name: "Follower thanks",
    why: "A follow is a viewer saying they want to come back. A quick thank-you in chat makes them feel seen the moment they do it.",
    note: "Someone who unfollows and follows again is thanked again.",
    fields: [
      {
        id: "followMessage",
        label: "Chat message",
        type: "text",
        maxLength: CHAT_MAX_LENGTH,
        defaultValue: "Thanks for the follow, {user}!",
      },
    ],
    items: [
      {
        kind: "workflow",
        id: "follower-thanks",
        name: "Follower thanks",
        description: "Thanks every new follower in chat.",
        trigger: { event: "channel.follow", label: "Someone follows you" },
        tokens: { user: "${trigger.data.userName}" },
        steps: [
          {
            kind: "action",
            id: "thank-follower",
            label: "Thank them in chat",
            action: STARTER_ACTION_REFS.chatReply,
            parameters: { message: { field: "followMessage" } },
          },
        ],
      },
    ],
  },
  {
    id: "sub-hype",
    name: "Sub & gift hype",
    why: "Subs keep a channel going. Thank every new sub, resub and gifter by name, and clip the big gift bombs so the hype lives on after the stream.",
    note: "A sub gifted to one named viewer arrives from Twitch as that viewer's sub, marked as a gift and without the gifter, so neither message thanks it. Gifts to the community are thanked through the gift message.",
    fields: [
      {
        id: "subMessage",
        label: "New sub message",
        type: "text",
        maxLength: CHAT_MAX_LENGTH,
        defaultValue: "Thank you for subscribing, {user}!",
      },
      {
        id: "resubMessage",
        label: "Resub message",
        type: "text",
        maxLength: CHAT_MAX_LENGTH,
        defaultValue: "{user} has been subscribed for {months} months. Thank you!",
      },
      {
        id: "giftMessage",
        label: "Gift message",
        type: "text",
        maxLength: CHAT_MAX_LENGTH,
        defaultValue: "{gifter} just gifted {count} subs! Thank you!",
      },
      {
        id: "giftBombMinimum",
        label: "Clip gift bombs of at least",
        description: "Gifts of this many subs or more are clipped and marked.",
        type: "number",
        defaultValue: 5,
        min: 2,
        max: 100,
      },
      {
        id: "giftBombMarker",
        label: "Gift bomb marker note",
        type: "text",
        maxLength: MARKER_MAX_LENGTH,
        defaultValue: "Gift bomb from {gifter}",
      },
    ],
    items: [
      {
        kind: "workflow",
        id: "sub-thanks",
        name: "Sub thanks",
        description: "Thanks new subscribers in chat. Gifted subs are thanked through their gifter instead.",
        trigger: {
          event: "channel.subscribe",
          label: "Someone subscribes",
          conditions: [{ path: "isGift", operator: "eq", value: false }],
        },
        tokens: { user: "${trigger.data.userName}" },
        steps: [
          {
            kind: "action",
            id: "thank-subscriber",
            label: "Thank them in chat",
            action: STARTER_ACTION_REFS.chatReply,
            parameters: { message: { field: "subMessage" } },
          },
        ],
      },
      {
        kind: "workflow",
        id: "resub-thanks",
        name: "Resub thanks",
        description: "Thanks subscribers who share their resub in chat.",
        trigger: { event: "channel.resub", label: "Someone shares a resub" },
        tokens: { user: "${trigger.data.chatterName}", months: "${trigger.data.cumulativeMonths}" },
        steps: [
          {
            kind: "action",
            id: "thank-resubscriber",
            label: "Thank them in chat",
            action: STARTER_ACTION_REFS.chatReply,
            parameters: { message: { field: "resubMessage" } },
          },
        ],
      },
      {
        kind: "workflow",
        id: "gift-thanks",
        name: "Gift sub thanks",
        description: "Thanks gifters in chat with how many subs they gave.",
        trigger: { event: "channel.subscriptionGift", label: "Someone gifts subs" },
        tokens: GIFT_TOKENS,
        steps: [
          {
            kind: "action",
            id: "thank-gifter",
            label: "Thank the gifter in chat",
            action: STARTER_ACTION_REFS.chatReply,
            parameters: { message: { field: "giftMessage" } },
          },
        ],
      },
      {
        kind: "workflow",
        id: "gift-bomb-clip",
        name: "Gift bomb clip",
        description: "Clips and marks the stream when a gift bomb lands.",
        trigger: {
          event: "channel.subscriptionGift",
          label: "Someone gifts a lot of subs at once",
          conditions: [{ path: "amount", operator: "gte", value: { field: "giftBombMinimum" } }],
        },
        tokens: GIFT_TOKENS,
        steps: [
          {
            kind: "action",
            id: "clip-gift-bomb",
            label: "Create a clip",
            action: STARTER_ACTION_REFS.clip,
            parameters: {},
          },
          {
            kind: "action",
            id: "mark-gift-bomb",
            label: "Place a stream marker",
            action: STARTER_ACTION_REFS.marker,
            parameters: { description: { field: "giftBombMarker" } },
          },
        ],
      },
    ],
  },
  {
    id: "cheer-thanks",
    name: "Cheer thanks",
    why: "Bits are viewers spending real money on you. Thank the cheers that clear your bar so chat sees it is noticed.",
    fields: [
      {
        id: "cheerMinimum",
        label: "Thank cheers of at least (bits)",
        type: "number",
        defaultValue: 100,
        min: 1,
        max: 1_000_000,
      },
      {
        id: "cheerMessage",
        label: "Chat message",
        type: "text",
        maxLength: CHAT_MAX_LENGTH,
        defaultValue: "{user} just cheered {bits} bits. Thank you!",
      },
    ],
    items: [
      {
        kind: "workflow",
        id: "cheer-thanks",
        name: "Cheer thanks",
        description: "Thanks cheers over a minimum amount in chat.",
        trigger: {
          event: "channel.cheer",
          label: "Someone cheers bits",
          conditions: [{ path: "amount", operator: "gte", value: { field: "cheerMinimum" } }],
        },
        tokens: {
          user: "${trigger.data.isAnonymous ? 'An anonymous cheerer' : trigger.data.userName}",
          bits: "${trigger.data.amount}",
        },
        steps: [
          {
            kind: "action",
            id: "thank-cheerer",
            label: "Thank them in chat",
            action: STARTER_ACTION_REFS.chatReply,
            parameters: { message: { field: "cheerMessage" } },
          },
        ],
      },
    ],
  },
  {
    id: "handy-commands",
    name: "Handy commands",
    why: "The two commands viewers type in almost every channel: where else to find you, and letting you know they are lurking.",
    fields: [
      {
        id: "socialsMessage",
        label: "!socials reply",
        type: "text",
        maxLength: CHAT_MAX_LENGTH,
        defaultValue: "Find me elsewhere: add your links here",
      },
      {
        id: "lurkMessage",
        label: "!lurk reply",
        type: "text",
        maxLength: CHAT_MAX_LENGTH,
        defaultValue: "{user} is lurking. Thanks for hanging out!",
      },
    ],
    items: [
      {
        kind: "command",
        id: "socials",
        command: "socials",
        description: "Posts your social links.",
        cooldown: 30,
        steps: [
          {
            kind: "action",
            id: "post-socials",
            label: "Post your links in chat",
            action: STARTER_ACTION_REFS.chatReply,
            parameters: { message: { field: "socialsMessage" } },
          },
        ],
      },
      {
        kind: "command",
        id: "lurk",
        command: "lurk",
        description: "Acknowledges a viewer going into lurk mode.",
        cooldown: 5,
        steps: [
          {
            kind: "action",
            id: "acknowledge-lurk",
            label: "Acknowledge them in chat",
            action: STARTER_ACTION_REFS.chatReply,
            parameters: { message: { field: "lurkMessage" } },
          },
        ],
      },
    ],
  },
  {
    id: "brb-scene",
    name: "BRB scene",
    why: "Step away without touching OBS: type !brb to switch to your break scene and !back to return.",
    note: "Needs OBS connected to the engine. Only you and your moderators can run these commands.",
    fields: [
      {
        id: "brbScene",
        label: "Break scene",
        description: "The scene's name exactly as OBS shows it.",
        type: "text",
        exact: true,
        defaultValue: "BRB",
      },
      {
        id: "mainScene",
        label: "Main scene",
        description: "The scene's name exactly as OBS shows it.",
        type: "text",
        exact: true,
        defaultValue: "Main",
      },
    ],
    items: [
      {
        kind: "command",
        id: "brb",
        command: "brb",
        description: "Switches OBS to your break scene.",
        cooldown: 0,
        restrictTo: ["broadcaster", "moderator"],
        steps: [
          {
            kind: "action",
            id: "switch-to-brb",
            label: "Switch to the break scene",
            action: STARTER_ACTION_REFS.switchScene,
            parameters: { sceneName: { field: "brbScene" } },
          },
        ],
      },
      {
        kind: "command",
        id: "back",
        command: "back",
        description: "Switches OBS back to your main scene.",
        cooldown: 0,
        restrictTo: ["broadcaster", "moderator"],
        steps: [
          {
            kind: "action",
            id: "switch-to-main",
            label: "Switch to the main scene",
            action: STARTER_ACTION_REFS.switchScene,
            parameters: { sceneName: { field: "mainScene" } },
          },
        ],
      },
    ],
  },
];

export function findStarterPack(packId: string): StarterPack | undefined {
  return STARTER_PACKS.find((pack) => pack.id === packId);
}

/** How an installed item is keyed, in status maps and the install ledger. */
export function starterItemKey(packId: string, itemId: string): string {
  return `${packId}/${itemId}`;
}

export function starterItemTokens(item: StarterItem): Record<string, string> {
  return item.kind === "workflow" ? item.tokens : COMMAND_TOKENS;
}

function isFieldRef(value: StarterValue): value is { field: string } {
  return typeof value === "object" && value !== null;
}

/** The ids of the pack fields an item reads. */
export function starterItemFieldIds(item: StarterItem): string[] {
  const values: StarterValue[] = [];
  for (const step of item.steps) {
    if (step.kind === "delay") {
      values.push(step.seconds);
    } else {
      values.push(...Object.values(step.parameters));
    }
  }
  if (item.kind === "workflow") {
    values.push(...(item.trigger.conditions ?? []).map((condition) => condition.value));
  }
  const ids = new Set<string>();
  for (const value of values) {
    if (isFieldRef(value)) {
      ids.add(value.field);
    }
  }
  return Array.from(ids);
}

// A `{name}` placeholder. The lookbehind leaves `${...}` expressions alone.
const TOKEN_PATTERN = /(?<!\$)\{([A-Za-z]+)\}/g;

/** The `{name}` placeholders in a piece of text. */
export function textTokens(text: string): string[] {
  return Array.from(text.matchAll(TOKEN_PATTERN), (match) => match[1]);
}

/** Replaces each `{name}` with the expression it stands for. Throws on a name the item does not offer. */
export function fillTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(TOKEN_PATTERN, (whole, name: string) => {
    const expression = tokens[name];
    if (expression === undefined) {
      throw new Error(`Unknown placeholder ${whole}`);
    }
    return expression;
  });
}

/** The placeholders each of a pack's text fields may use: those every item reading the field offers. */
export function fieldTokenNames(pack: StarterPack, fieldId: string): string[] {
  const readers = pack.items.filter((item) => starterItemFieldIds(item).includes(fieldId));
  if (readers.length === 0) {
    return [];
  }
  const offeredByEach = readers.map((item) => Object.keys(starterItemTokens(item)));
  return offeredByEach[0].filter((name) => offeredByEach.every((offered) => offered.includes(name)));
}

export function starterPackDefaults(pack: StarterPack): StarterFieldValues {
  const values: StarterFieldValues = {};
  for (const field of pack.fields) {
    values[field.id] = field.defaultValue;
  }
  return values;
}

/** How long text is likely to be once its placeholders are filled in. */
export function estimatedLength(text: string): number {
  return text.replace(TOKEN_PATTERN, "x".repeat(PLACEHOLDER_LENGTH_ESTIMATE)).length;
}

/**
 * Something about a value worth pointing out that is not wrong: an exact
 * value with spaces at either end, which is legal but rarely meant.
 */
export function starterFieldWarning(field: StarterPackField, value: StarterFieldValue): string | null {
  if (field.exact === true && typeof value === "string" && value !== value.trim()) {
    return "Starts or ends with a space. OBS matches the name exactly, spaces included.";
  }
  return null;
}

export type StarterValuesResult =
  | { ok: true; values: StarterFieldValues }
  | { ok: false; errors: Record<string, string> };

/**
 * Checks field values a person entered against the pack's fields, filling any
 * that were left out with their defaults. Errors are keyed by field id.
 */
export function validateStarterValues(
  pack: StarterPack,
  input: Record<string, unknown>,
  features: StarterFeatures
): StarterValuesResult {
  const errors: Record<string, string> = {};
  const values: StarterFieldValues = {};
  const known = new Set(pack.fields.map((field) => field.id));
  for (const id of Object.keys(input)) {
    if (!known.has(id)) {
      errors[id] = "This pack has no such setting.";
    }
  }
  for (const field of pack.fields) {
    const raw = input[field.id] ?? field.defaultValue;
    if (field.type === "number") {
      if (typeof raw !== "number" || !Number.isInteger(raw)) {
        errors[field.id] = "Enter a whole number.";
        continue;
      }
      if ((field.min !== undefined && raw < field.min) || (field.max !== undefined && raw > field.max)) {
        errors[field.id] = `Enter a number from ${field.min} to ${field.max}.`;
        continue;
      }
      if (field.requires !== undefined && !features[field.requires] && raw !== field.defaultValue) {
        errors[field.id] = `Requires engine update. Leave it at ${field.defaultValue}.`;
        continue;
      }
      values[field.id] = raw;
      continue;
    }
    if (typeof raw !== "string" || raw.trim() === "") {
      errors[field.id] = "This can't be empty.";
      continue;
    }
    const text = field.exact === true ? raw : raw.trim();
    // The engine resolves any `${...}` in a parameter, `${env.NAME}` included,
    // and has no escape for it: text that could carry one could post the
    // engine's environment to chat.
    if (text.includes("${")) {
      errors[field.id] = "Engine expressions (${...}) aren't allowed here. Use the placeholders.";
      continue;
    }
    if (field.maxLength !== undefined && estimatedLength(text) > field.maxLength) {
      errors[field.id] =
        textTokens(text).length > 0
          ? `Keep it under ${field.maxLength} characters, counting each placeholder as ${PLACEHOLDER_LENGTH_ESTIMATE}.`
          : `Keep it under ${field.maxLength} characters.`;
      continue;
    }
    const allowed = new Set(fieldTokenNames(pack, field.id));
    const unknown = textTokens(text).find((name) => !allowed.has(name));
    if (unknown !== undefined) {
      const offered = Array.from(allowed, (name) => `{${name}}`).join(", ");
      errors[field.id] = offered
        ? `{${unknown}} isn't a placeholder here. Use ${offered}.`
        : `{${unknown}} isn't a placeholder here.`;
      continue;
    }
    values[field.id] = text;
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, values };
}

/** The parts of an instance's workflow catalog a pack is resolved against. */
export interface StarterCatalog {
  triggers: { event?: string; canonicalRef?: string }[];
  actions: { canonicalRef?: string; handlerType?: string; functionCall?: string; configFields?: unknown }[];
}

export interface StarterRequirements {
  /** Trigger events the catalog has no trigger for. */
  triggers: string[];
  /** Action refs the catalog lacks, or has without an input a step sets. */
  actions: StarterActionRef[];
  /** Whether the catalog has anything from the Twitch module, which tells a missing module from an outdated one. */
  twitchModuleInstalled: boolean;
}

function refModule(ref: string): string {
  return ref.slice(0, ref.indexOf(":"));
}

/**
 * The input ids an action declares, from its catalog `configFields`, or null
 * when the entry carries no field list to judge by.
 */
function declaredInputs(entry: StarterCatalog["actions"][number]): Set<string> | null {
  if (!Array.isArray(entry.configFields)) {
    return null;
  }
  const ids = new Set<string>();
  for (const field of entry.configFields) {
    if (typeof field === "object" && field !== null && typeof (field as { id?: unknown }).id === "string") {
      ids.add((field as { id: string }).id);
    }
  }
  return ids;
}

/**
 * Whether the catalog's version of an action takes every parameter the step
 * sets. An action ignores an input it does not declare, so a step relying on
 * one (the raid shoutout's skipIfRateLimited) would run without the behaviour
 * it was written for; the input's presence is the version check, since the
 * catalog carries no module version to compare.
 */
function supportsStep(step: StarterActionStep, catalog: StarterCatalog): boolean {
  const entry = catalog.actions.find((action) => action.canonicalRef === step.action);
  if (!entry) {
    return false;
  }
  const inputs = declaredInputs(entry);
  if (inputs === null) {
    return true;
  }
  return Object.keys(step.parameters).every((key) => inputs.has(key));
}

export function missingRequirements(item: StarterItem, catalog: StarterCatalog): StarterRequirements {
  const triggers: string[] = [];
  if (item.kind === "workflow" && !catalog.triggers.some((trigger) => trigger.event === item.trigger.event)) {
    triggers.push(item.trigger.event);
  }
  const actions = new Set<StarterActionRef>();
  for (const step of item.steps) {
    if (step.kind === "action" && !supportsStep(step, catalog)) {
      actions.add(step.action);
    }
  }
  const twitchModuleInstalled = [...catalog.triggers, ...catalog.actions].some(
    (entry) => entry.canonicalRef !== undefined && refModule(entry.canonicalRef) === STARTER_MODULES.twitch
  );
  return { triggers, actions: Array.from(actions), twitchModuleInstalled };
}

export function hasRequirements(missing: StarterRequirements): boolean {
  return missing.triggers.length === 0 && missing.actions.length === 0;
}

/**
 * Why an item cannot be installed, in the streamer's terms. Every trigger a
 * pack binds to comes from the Twitch module, as do the Twitch actions; the
 * rest are the engine's own. A Twitch module that is installed but lacks
 * something is an older version, which updating the module fixes.
 */
export function requirementsMessage(missing: StarterRequirements): string | null {
  const missingTwitchAction = missing.actions.some((ref) => refModule(ref) === STARTER_MODULES.twitch);
  const missingEngineAction = missing.actions.some((ref) => refModule(ref) === STARTER_MODULES.engine);
  const needsTwitch = missing.triggers.length > 0 || missingTwitchAction;
  if (needsTwitch && !missing.twitchModuleInstalled) {
    return "Requires the Twitch module";
  }
  if (missingEngineAction) {
    return "Requires engine update";
  }
  if (needsTwitch) {
    return "Requires the Twitch module (update it)";
  }
  return null;
}

function resolveValue(value: StarterValue, values: StarterFieldValues, tokens: Record<string, string>): unknown {
  if (isFieldRef(value)) {
    const fieldValue = values[value.field];
    if (fieldValue === undefined) {
      throw new Error(`No value for field "${value.field}"`);
    }
    return typeof fieldValue === "string" ? fillTokens(fieldValue, tokens) : fieldValue;
  }
  return typeof value === "string" ? fillTokens(value, tokens) : value;
}

function resolveParameters(
  parameters: Record<string, StarterValue>,
  values: StarterFieldValues,
  tokens: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    out[key] = resolveValue(value, values, tokens);
  }
  return out;
}

function catalogAction(ref: StarterActionRef, catalog: StarterCatalog) {
  const entry = catalog.actions.find((action) => action.canonicalRef === ref);
  if (!entry) {
    throw new Error(`The catalog has no action ${ref}`);
  }
  const handlerType = entry.handlerType?.trim() || (entry.functionCall?.trim() ? "function" : undefined);
  if (!handlerType) {
    throw new Error(`Action ${ref} is missing its handler type; re-sync the catalog`);
  }
  return { handlerType, functionCall: entry.functionCall?.trim() || undefined };
}

/** An engine task as the wizard writes it: the canonical shape plus graph metadata and function dispatch. */
export type StarterTask = Omit<TaskDefinition, "wait"> & {
  $ref?: string;
  function?: string;
  /** A delay wait, which the canonical WaitConfig of older engines does not model. */
  wait?: { type: "delay"; durationMs: number };
};

export type StarterWorkflowDefinition = Omit<WorkflowDefinition, "id" | "tasks" | "trigger"> & {
  trigger: { type: "event"; event: string; conditions: ConditionConfig[]; $ref?: string };
  tasks: StarterTask[];
};

function buildStarterTask(
  step: StarterStep,
  values: StarterFieldValues,
  tokens: Record<string, string>,
  catalog: StarterCatalog
): StarterTask | null {
  if (step.kind === "delay") {
    const seconds = resolveValue(step.seconds, values, tokens);
    if (typeof seconds !== "number") {
      throw new Error(`Delay "${step.id}" must be a number of seconds`);
    }
    if (seconds === 0) {
      return null;
    }
    return { id: step.id, type: "wait", wait: { type: "delay", durationMs: seconds * 1000 } };
  }
  const { handlerType, functionCall } = catalogAction(step.action, catalog);
  const task: StarterTask = {
    id: step.id,
    type: "action",
    action: handlerType,
    parameters: resolveParameters(step.parameters, values, tokens),
    $ref: step.action,
  };
  if (functionCall) {
    task.function = functionCall;
  }
  return task;
}

/**
 * The workflow an item installs, in the shape `createWorkflow` takes. Steps run
 * one after another; a delay of zero seconds is left out rather than sent.
 */
export function buildStarterWorkflow(
  item: StarterWorkflowItem,
  values: StarterFieldValues,
  catalog: StarterCatalog
): StarterWorkflowDefinition {
  const trigger = catalog.triggers.find((entry) => entry.event === item.trigger.event);
  if (!trigger) {
    throw new Error(`The catalog has no trigger for ${item.trigger.event}`);
  }
  const conditions: ConditionConfig[] = (item.trigger.conditions ?? []).map((condition) => ({
    field: `\${trigger.data.${condition.path}}`,
    operator: condition.operator,
    value: resolveValue(condition.value, values, item.tokens),
  }));

  const tasks: StarterTask[] = [];
  for (const step of item.steps) {
    const task = buildStarterTask(step, values, item.tokens, catalog);
    if (!task) {
      continue;
    }
    const previous = tasks.at(-1);
    if (previous) {
      task.dependsOn = [previous.id];
    }
    tasks.push(task);
  }

  const block: StarterWorkflowDefinition["trigger"] = { type: "event", event: item.trigger.event, conditions };
  if (trigger.canonicalRef) {
    block.$ref = trigger.canonicalRef;
  }
  return { name: item.name, description: item.description, trigger: block, tasks };
}

export interface StarterCommandDefinition {
  command: string;
  actions: ActionStep[];
  cooldown: number;
  restrictTo: BuiltInGroupName[];
}

/** The chat command an item installs, before its groups are resolved to engine ids. */
export function buildStarterCommand(
  item: StarterCommandItem,
  values: StarterFieldValues,
  catalog: StarterCatalog
): StarterCommandDefinition {
  const actions = item.steps.map((step): ActionStep => {
    const { handlerType, functionCall } = catalogAction(step.action, catalog);
    const action: ActionStep = {
      id: step.id,
      action: handlerType,
      parameters: resolveParameters(step.parameters, values, COMMAND_TOKENS),
      $ref: step.action,
    };
    if (functionCall) {
      action.function = functionCall;
    }
    return action;
  });
  return { command: item.command, actions, cooldown: item.cooldown, restrictTo: item.restrictTo ?? [] };
}
