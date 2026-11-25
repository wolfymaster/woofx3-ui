import type { ConditionConfig, ConditionOperator } from "@woofx3/api";
import { commandItems, pushNote, workflowItem } from "./build";
import {
  CHAT_COMMAND_CONTEXT,
  type EventContext,
  type EventField,
  eventContext,
  fieldExpression,
  SCHEDULE_CONTEXT,
  triggerData,
} from "./events";
import {
  asArray,
  asCollection,
  asFlag,
  asNumber,
  asRecord,
  asRecords,
  asString,
  commandWord,
  type JsonRecord,
  resourceIdFromName,
} from "./read";
import { translateFirebotText, unknownVariablesMessage } from "./templates";
import {
  type CommandAccess,
  IMPORT_ACTION_REFS,
  type ImportItem,
  type ImportLeftover,
  type ImportNote,
  type ImportPlan,
  type ImportStep,
} from "./types";

/**
 * Firebot (crowbartools/Firebot, v5) to woofx3.
 *
 * Reads the `components` of a `.firebotsetup` file, which a backup's profile
 * files are gathered into by `firebotDocumentFromBackup` (decode.ts), so both
 * exports convert the same way. Shapes follow Firebot's src/types and the
 * effect definitions under src/backend/effects.
 */

export interface FirebotDocument {
  name: string;
  components: JsonRecord;
}

const ORIGIN = {
  command: "Firebot command",
  event: "Firebot event",
  timer: "Firebot timer",
  scheduledTask: "Firebot scheduled task",
  counter: "Firebot counter",
  role: "Firebot custom role",
} as const;

/** How deep preset lists may call each other before the import stops following them. */
const MAX_PRESET_DEPTH = 8;

/** Names for the effects woofx3 has no equivalent of, as the report shows them. */
const EFFECT_NAMES: Record<string, string> = {
  "firebot:playsound": "Play Sound",
  "firebot:playvideo": "Play Video",
  "firebot:showImage": "Show Image",
  "firebot:showtext": "Show Text",
  "firebot:show-text": "Show Text",
  "firebot:html": "Show HTML",
  "firebot:overlayalert": "Overlay Alert",
  "firebot:celebration": "Celebrate",
  "firebot:text-to-speech": "Text to Speech",
  "firebot:currency": "Update Currency",
  "firebot:customvariable": "Set Custom Variable",
  "firebot:http-request": "HTTP Request",
  "firebot:customscript": "Run Custom Script",
  "firebot:eval-js": "Evaluate JavaScript",
  "firebot:run-program": "Run Program",
  "firebot:filewriter": "Write To File",
  "firebot:randomeffect": "Random Effect",
  "firebot:sequentialeffect": "Sequential Effect",
  "firebot:loopeffects": "Loop Effects",
  "firebot:switch-statement": "Switch Statement",
  "firebot:runcommand": "Run Command",
  "firebot:announcement": "Chat Announcement",
  "firebot:raid": "Start Raid",
  "firebot:ad-break": "Run Ad",
  "firebot:modban": "Ban",
  "firebot:modpurge": "Purge",
  "firebot:clearchat": "Clear Chat",
  "firebot:delete-chat-message": "Delete Chat Message",
  "firebot:set-chat-mode": "Set Chat Mode",
  "firebot:update-vip-role": "Update VIP",
  "firebot:update-roles": "Update Viewer Roles",
  "firebot:dice": "Roll Dice",
  "firebot:add-quote": "Add Quote",
  "firebot:toggle-command": "Toggle Command",
  "firebot:toggle-event": "Toggle Event",
  "firebot:toggle-timer": "Toggle Timer",
  "twitch:create-poll": "Create Poll",
  "twitch:create-prediction": "Create Prediction",
  "ebiggz:obs-change-scene-collection": "Change OBS Scene Collection",
  "ebiggz:obs-toggle-source-filter": "Toggle OBS Source Filter",
  "ebiggz:obs-start-stream": "Start OBS Stream",
  "ebiggz:obs-stop-stream": "Stop OBS Stream",
  "firebot:obs-set-source-text": "Set OBS Text Source",
  "firebot:obs-set-browser-source-url": "Set OBS Browser Source URL",
  "firebot:obs-set-image-source-file": "Set OBS Image Source",
  "firebot:obs-set-media-source-file": "Set OBS Media Source",
  "firebot:obs-save-replay-buffer": "Save OBS Replay Buffer",
};

/** Effects that only decorate the list in Firebot's editor and do nothing when run. */
const INERT_EFFECTS = new Set(["firebot:comment"]);

interface Scope {
  context: EventContext;
  presets: Map<string, JsonRecord>;
  counters: Map<string, string>;
  presetArgs: Record<string, string>;
  depth: number;
  notes: ImportNote[];
}

function text(value: unknown, scope: Scope): string {
  const translated = translateFirebotText(asString(value), scope.context, scope.presetArgs);
  if (translated.unknown.length > 0) {
    pushNote(scope.notes, { message: unknownVariablesMessage(translated.unknown) });
  }
  return translated.text;
}

function dropEffect(scope: Scope, type: string, why?: string): ImportStep[] {
  const name = EFFECT_NAMES[type] ?? type;
  pushNote(scope.notes, { message: why ?? `Leaves out the ${name} effect, which woofx3 cannot run yet.` });
  return [];
}

const CUSTOM_CONDITION_OPERATORS: Record<string, ConditionOperator> = {
  is: "eq",
  "is strictly": "eq",
  "is not": "ne",
  "is not strictly": "ne",
  "is less than": "lt",
  "is less than or equal to": "lte",
  "is greater than": "gt",
  "is greater than or equal to": "gte",
  contains: "contains",
  "matches regex": "regex",
};

/** Swapping the sides of a comparison flips its direction. */
const MIRRORED: Partial<Record<ConditionOperator, ConditionOperator>> = {
  eq: "eq",
  ne: "ne",
  lt: "gt",
  lte: "gte",
  gt: "lt",
  gte: "lte",
};

/** A whole `${...}` and nothing else: something a condition can read. */
const SINGLE_EXPRESSION = /^\$\{[^}]+\}$/;

function literal(value: string): string | number {
  const number = asNumber(value);
  return number === null ? value : number;
}

function compare(left: string, operator: ConditionOperator, right: string): ConditionConfig | null {
  if (SINGLE_EXPRESSION.test(left)) {
    return { field: left, operator, value: literal(right) };
  }
  const mirrored = MIRRORED[operator];
  if (SINGLE_EXPRESSION.test(right) && mirrored !== undefined) {
    return { field: right, operator: mirrored, value: literal(left) };
  }
  return null;
}

function convertCondition(condition: JsonRecord, scope: Scope): ConditionConfig | null {
  const type = asString(condition.type);
  const comparison = asString(condition.comparisonType);
  if (type === "firebot:custom") {
    const operator = CUSTOM_CONDITION_OPERATORS[comparison];
    if (operator === undefined) {
      return null;
    }
    return compare(text(condition.leftSideValue, scope), operator, text(condition.rightSideValue, scope));
  }
  if (type === "firebot:username") {
    const user = fieldExpression(scope.context, "user");
    const operator = comparison === "is" ? "eq" : comparison === "is not" ? "ne" : null;
    if (user === null || operator === null) {
      return null;
    }
    return { field: user, operator, value: asString(condition.rightSideValue) };
  }
  return null;
}

/** Firebot's "inclusive" passes when any condition does, "exclusive" only when all do. */
function conditionLogic(data: JsonRecord): "and" | "or" {
  return asString(data.mode) === "inclusive" ? "or" : "and";
}

function convertConditions(data: unknown, scope: Scope): { conditions: ConditionConfig[]; logic: "and" | "or" } | null {
  const record = asRecord(data);
  if (!record) {
    return null;
  }
  const conditions: ConditionConfig[] = [];
  for (const condition of asRecords(record.conditions)) {
    const converted = convertCondition(condition, scope);
    if (!converted) {
      return null;
    }
    conditions.push(converted);
  }
  return conditions.length === 0 ? null : { conditions, logic: conditionLogic(record) };
}

function convertConditional(effect: JsonRecord, scope: Scope): ImportStep[] {
  const clauses = asRecords(effect.ifs);
  let whenFalse = convertEffectList(effect.otherwiseEffectData, scope);
  // Else-if chains nest from the last clause outwards: each later clause is the
  // earlier one's else.
  for (let index = clauses.length - 1; index >= 0; index--) {
    const clause = clauses[index];
    const converted = convertConditions(clause.conditionData, scope);
    if (!converted) {
      pushNote(scope.notes, {
        message: "Leaves out a Conditional Effects step whose conditions woofx3 cannot check.",
      });
      return [];
    }
    const whenTrue = convertEffectList(clause.effectData, scope);
    whenFalse = [
      {
        kind: "branch",
        label: "If/else",
        conditions: converted.conditions,
        logic: converted.logic,
        whenTrue,
        whenFalse,
      },
    ];
  }
  return whenFalse;
}

function convertRunEffectList(effect: JsonRecord, scope: Scope): ImportStep[] {
  if (asString(effect.listType) !== "preset") {
    return convertEffectList(effect.effectList, scope);
  }
  const preset = scope.presets.get(asString(effect.presetListId));
  if (!preset) {
    pushNote(scope.notes, { message: "Runs a preset effect list that is not in this file, so that part is left out." });
    return [];
  }
  if (scope.depth >= MAX_PRESET_DEPTH) {
    pushNote(scope.notes, { message: "Preset effect lists call each other too deeply; the innermost are left out." });
    return [];
  }
  const presetArgs: Record<string, string> = {};
  const args = asRecord(effect.presetListArgs) ?? {};
  for (const [name, value] of Object.entries(args)) {
    presetArgs[name] = text(value, scope);
  }
  return convertEffectList(preset.effects, { ...scope, presetArgs, depth: scope.depth + 1 });
}

function convertCounterUpdate(effect: JsonRecord, scope: Scope): ImportStep[] {
  const counterKey = scope.counters.get(asString(effect.counterId));
  const value = asNumber(effect.value);
  if (counterKey === undefined) {
    return dropEffect(
      scope,
      "firebot:update-counter",
      "Updates a counter that is not in this file, so that step is left out."
    );
  }
  if (value === null) {
    return dropEffect(
      scope,
      "firebot:update-counter",
      "Updates a counter by an amount worked out from variables, which woofx3 cannot do; that step is left out."
    );
  }
  const target = { counterKey };
  if (asString(effect.mode) === "set") {
    return [
      { kind: "action", label: "Set counter", ref: IMPORT_ACTION_REFS.counterSet, parameters: { target, value } },
    ];
  }
  if (value < 0) {
    return [
      {
        kind: "action",
        label: "Decrease counter",
        ref: IMPORT_ACTION_REFS.counterDecrement,
        parameters: { target, amount: -value },
      },
    ];
  }
  return [
    {
      kind: "action",
      label: "Increase counter",
      ref: IMPORT_ACTION_REFS.counterIncrement,
      parameters: { target, amount: value },
    },
  ];
}

function convertSourceVisibility(effect: JsonRecord, scope: Scope): ImportStep[] {
  const steps: ImportStep[] = [];
  for (const source of asRecords(effect.selectedSources)) {
    const sourceName = asString(source.sourceName);
    if (sourceName === "") {
      pushNote(scope.notes, { message: "Leaves out an OBS source this file names only by its OBS id." });
      continue;
    }
    if (typeof source.action !== "boolean") {
      pushNote(scope.notes, { message: "Leaves out toggling an OBS source, which woofx3 can only show or hide." });
      continue;
    }
    steps.push({
      kind: "action",
      label: source.action ? "Show OBS source" : "Hide OBS source",
      ref: IMPORT_ACTION_REFS.sourceVisibility,
      parameters: { sourceName, visible: source.action, sceneName: asString(source.sceneName) },
    });
  }
  return steps;
}

function convertSourceMute(effect: JsonRecord, scope: Scope): ImportStep[] {
  const steps: ImportStep[] = [];
  for (const source of asRecords(effect.selectedSources)) {
    if (typeof source.action !== "boolean") {
      pushNote(scope.notes, { message: "Leaves out toggling an OBS mute, which woofx3 can only mute or unmute." });
      continue;
    }
    steps.push({
      kind: "action",
      label: source.action ? "Mute OBS input" : "Unmute OBS input",
      ref: IMPORT_ACTION_REFS.inputMute,
      parameters: { inputName: asString(source.sourceName), muted: source.action },
    });
  }
  return steps;
}

function convertStreamGame(effect: JsonRecord, scope: Scope): ImportStep[] {
  const mode = asString(effect.mode);
  const category =
    mode === "specific" ? asString(effect.specificGameName) || asString(effect.gameName) : text(effect.gameName, scope);
  if (mode === "clear" || category === "") {
    return dropEffect(scope, "firebot:streamgame", "Leaves out clearing the stream category, which woofx3 cannot do.");
  }
  return [
    { kind: "action", label: "Set stream category", ref: IMPORT_ACTION_REFS.updateStream, parameters: { category } },
  ];
}

function convertEffect(effect: JsonRecord, scope: Scope): ImportStep[] {
  const type = asString(effect.type);
  switch (type) {
    case "firebot:chat": {
      if (asString(effect.whisper) !== "") {
        pushNote(scope.notes, { message: "Sends whispers as ordinary chat messages; woofx3 cannot whisper." });
      }
      return [
        {
          kind: "action",
          label: "Send chat message",
          ref: IMPORT_ACTION_REFS.chatReply,
          parameters: { message: text(effect.message, scope) },
        },
      ];
    }
    case "firebot:delay": {
      const seconds = asNumber(effect.delay);
      if (seconds === null || seconds <= 0) {
        return dropEffect(scope, type, "Leaves out a delay whose length is worked out from variables.");
      }
      return [{ kind: "delay", label: `Wait ${seconds}s`, ms: Math.round(seconds * 1000) }];
    }
    case "firebot:conditional-effects":
      return convertConditional(effect, scope);
    case "firebot:run-effect-list":
      return convertRunEffectList(effect, scope);
    case "firebot:update-counter":
      return convertCounterUpdate(effect, scope);
    case "firebot:twitch-shoutout":
      return [
        {
          kind: "action",
          label: "Shout out",
          ref: IMPORT_ACTION_REFS.shoutout,
          parameters: { user: text(effect.username, scope), skipIfRateLimited: true },
        },
      ];
    case "firebot:create-stream-marker":
      return [
        {
          kind: "action",
          label: "Place a stream marker",
          ref: IMPORT_ACTION_REFS.marker,
          parameters: { description: text(effect.description, scope) },
        },
      ];
    case "firebot:clip":
      if (effect.postLink === true || effect.showInOverlay === true || effect.postInDiscord === true) {
        pushNote(scope.notes, {
          message: "Creates the clip but does not post it to chat, Discord or the overlay; woofx3 only creates it.",
        });
      }
      return [{ kind: "action", label: "Create a clip", ref: IMPORT_ACTION_REFS.clip, parameters: {} }];
    case "firebot:streamtitle":
      return [
        {
          kind: "action",
          label: "Set stream title",
          ref: IMPORT_ACTION_REFS.updateStream,
          parameters: { title: text(effect.title, scope) },
        },
      ];
    case "firebot:streamgame":
      return convertStreamGame(effect, scope);
    case "firebot:modTimeout": {
      const seconds = asNumber(effect.time);
      if (seconds === null) {
        return dropEffect(scope, type, "Leaves out a timeout whose length is worked out from variables.");
      }
      return [
        {
          kind: "action",
          label: "Time out a chatter",
          ref: IMPORT_ACTION_REFS.timeout,
          parameters: {
            user: text(effect.username, scope),
            durationSeconds: seconds,
            reason: text(effect.reason, scope),
          },
        },
      ];
    }
    case "ebiggz:obs-change-scene":
      return [
        {
          kind: "action",
          label: "Switch OBS scene",
          ref: IMPORT_ACTION_REFS.switchScene,
          parameters: { sceneName: text(effect.sceneName, scope) },
        },
      ];
    case "ebiggz:obs-toggle-source-visibility":
      return convertSourceVisibility(effect, scope);
    case "ebiggz:obs-toggle-source-muted":
      return convertSourceMute(effect, scope);
    default:
      if (INERT_EFFECTS.has(type)) {
        return [];
      }
      return dropEffect(scope, type);
  }
}

function convertEffectList(list: unknown, scope: Scope): ImportStep[] {
  const record = asRecord(list);
  if (!record) {
    return [];
  }
  const runMode = asString(record.runMode);
  if (runMode === "random" || runMode === "sequential") {
    pushNote(scope.notes, {
      message: `Leaves out an effect list that runs one effect ${runMode === "random" ? "at random" : "in turn"} each time; woofx3 cannot pick one.`,
    });
    return [];
  }
  const steps: ImportStep[] = [];
  for (const effect of asRecords(record.list)) {
    if (effect.active === false) {
      continue;
    }
    steps.push(...convertEffect(effect, scope));
  }
  return steps;
}

const BUILT_IN_ROLES: Record<string, "broadcaster" | "moderator"> = {
  broadcaster: "broadcaster",
  mod: "moderator",
};

const UNSUPPORTED_ROLE_NAMES: Record<string, string> = {
  vip: "VIPs",
  sub: "subscribers",
  viewerlistbot: "bots",
};

/** Restrictions whose absence lets the command run more often, but harmlessly so. */
const LOOSENED_RESTRICTIONS: Record<string, string> = {
  "firebot:only-when-live": "It also runs while you are offline; woofx3 commands cannot require a live stream.",
  "firebot:followcheck": "Anyone can use it, not just followers; woofx3 commands cannot check follows.",
  "firebot:limit-per-stream": "Its per-stream use limit is left out.",
  "firebot:activeChatUsers": "Its active-chatter requirement is left out.",
  "firebot:chatMessages": "Its chat-message-count requirement is left out.",
  "firebot:viewTime": "Its watch-time requirement is left out.",
  "firebot:timeRange": "Its time-of-day restriction is left out.",
  "firebot:channelGame": "Its stream-category restriction is left out.",
  "firebot:channelViewers": "Its viewer-count restriction is left out.",
};

/**
 * Who may use a command. A role woofx3 cannot gate on (VIPs, subscribers) is
 * never widened to everyone: the command stays with the roles that can be
 * expressed, falling back to the broadcaster and moderators.
 */
function commandAccess(restrictionData: unknown, roleKeys: Map<string, string>, notes: ImportNote[]): CommandAccess {
  const access: CommandAccess = { builtIn: [], groupKeys: [], usernames: [] };
  const data = asRecord(restrictionData);
  if (!data) {
    return access;
  }
  const mode = asString(data.mode);
  if (mode === "none" || data.invertCondition === true) {
    pushNote(notes, {
      message: 'Its restrictions are inverted ("none must pass"), which woofx3 cannot express.',
      blocking: true,
    });
    return access;
  }
  let dropped: string[] = [];
  for (const restriction of asRecords(data.restrictions)) {
    const type = asString(restriction.type);
    if (type === "firebot:permissions") {
      if (asString(restriction.mode) === "viewer") {
        const username = asString(restriction.username).trim().toLowerCase();
        if (username !== "") {
          access.usernames.push(username);
        }
        continue;
      }
      for (const roleId of asArray(restriction.roleIds).map(asString)) {
        const builtIn = BUILT_IN_ROLES[roleId];
        if (builtIn !== undefined) {
          access.builtIn.push(builtIn);
          continue;
        }
        const groupKey = roleKeys.get(roleId);
        if (groupKey !== undefined) {
          access.groupKeys.push(groupKey);
          continue;
        }
        dropped.push(UNSUPPORTED_ROLE_NAMES[roleId] ?? "a role not in this file");
      }
      continue;
    }
    if (type === "firebot:channelcurrency") {
      pushNote(notes, { message: "It costs currency to use, and woofx3 has no currencies.", blocking: true });
      continue;
    }
    const loosened = LOOSENED_RESTRICTIONS[type];
    pushNote(notes, { message: loosened ?? `Its "${type}" restriction is left out.` });
  }
  dropped = Array.from(new Set(dropped));
  if (dropped.length > 0) {
    const restricted = access.builtIn.length + access.groupKeys.length + access.usernames.length > 0;
    if (!restricted) {
      access.builtIn.push("broadcaster", "moderator");
    }
    pushNote(notes, {
      message: `It was open to ${dropped.join(" and ")}, which woofx3 commands cannot check; ${
        restricted
          ? "the other roles it allowed keep it"
          : "only you and your moderators can use it until you change that"
      }.`,
    });
  }
  access.builtIn = Array.from(new Set(access.builtIn));
  return access;
}

function convertCommand(
  command: JsonRecord,
  scope: Omit<Scope, "context" | "notes">,
  roleKeys: Map<string, string>
): ImportItem[] {
  const id = asString(command.id);
  const trigger = asString(command.trigger);
  const name = trigger || asString(command.name) || "Unnamed command";
  const notes: ImportNote[] = [];
  const base = { key: `firebot:command:${id}`, name, origin: ORIGIN.command, notes };

  if (command.triggerIsRegex === true) {
    pushNote(notes, {
      message: "It is triggered by a regular expression; woofx3 commands match a word.",
      blocking: true,
    });
  }
  if (command.scanWholeMessage === true) {
    pushNote(notes, { message: "It only runs when the message starts with the command, not anywhere in it." });
  }
  const cooldown = asRecord(command.cooldown) ?? {};
  const globalCooldown = asNumber(cooldown.global) ?? 0;
  if ((asNumber(cooldown.user) ?? 0) > 0) {
    pushNote(notes, { message: "Its per-user cooldown is left out; the shared cooldown still applies." });
  }
  if (asRecords(command.subCommands).some((sub) => sub.active !== false)) {
    pushNote(notes, { message: "Its subcommands are not imported; only what the command itself does is." });
  }
  const access = commandAccess(command.restrictionData, roleKeys, notes);
  const steps = convertEffectList(command.effects, { ...scope, context: CHAT_COMMAND_CONTEXT, notes });

  const words = [trigger, ...asArray(command.aliases).map(asString)];
  const items: ImportItem[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of words.entries()) {
    const word = commandWord(raw);
    if (word === null) {
      if (index === 0) {
        pushNote(notes, { message: `"${raw}" is not a command word woofx3 can match.`, blocking: true });
        items.push({ ...base, kind: "command", spec: emptyCommand(raw) });
      }
      continue;
    }
    if (seen.has(word)) {
      continue;
    }
    seen.add(word);
    const itemBase =
      index === 0
        ? base
        : { key: `${base.key}:alias:${word}`, name: `!${word}`, origin: ORIGIN.command, notes: [...notes] };
    items.push(
      ...commandItems(
        itemBase,
        { command: word, enabled: asFlag(command.active, true), cooldown: Math.max(0, globalCooldown), access },
        steps
      )
    );
  }
  return items;
}

function emptyCommand(word: string) {
  return {
    command: word,
    enabled: false,
    cooldown: 0,
    access: { builtIn: [], groupKeys: [], usernames: [] },
    steps: [],
  };
}

interface EventBinding {
  event: string;
  label?: string;
  conditions?: ConditionConfig[];
}

/** Firebot Twitch events, by event id, and the woofx3 events that carry each. */
const TWITCH_EVENTS: Record<string, EventBinding[]> = {
  follow: [{ event: "channel.follow" }],
  // Firebot's sub event covers new subs and shared resubs; woofx3 has one event for each.
  sub: [
    {
      event: "channel.subscribe",
      label: "new subs",
      conditions: [{ field: triggerData("isGift"), operator: "eq", value: false }],
    },
    { event: "channel.resub", label: "resubs" },
  ],
  "subs-gifted": [
    { event: "channel.subscribe", conditions: [{ field: triggerData("isGift"), operator: "eq", value: true }] },
  ],
  "community-subs-gifted": [{ event: "channel.subscriptionGift" }],
  cheer: [{ event: "channel.cheer" }],
  raid: [{ event: "channel.raid" }],
  "channel-reward-redemption": [{ event: "channelpoints.redeem" }],
  "chat-message": [{ event: "user.message" }],
  "stream-online": [{ event: "stream.online" }],
  "stream-offline": [{ event: "stream.offline" }],
  "hype-train-start": [{ event: "channel.hypetrain" }],
  "ad-break-upcoming": [{ event: "channel.ad_break.upcoming" }],
  "ad-break-start": [{ event: "channel.ad_break.begin" }],
  "ad-break-end": [{ event: "channel.ad_break.end" }],
  "charity-donation": [{ event: "channel.charityDonation" }],
  announcement: [{ event: "channel.announcement" }],
  "watch-streak": [{ event: "channel.watchStreak" }],
  "prime-sub-upgraded": [{ event: "channel.primePaidUpgrade" }],
  "gift-sub-upgraded": [{ event: "channel.giftPaidUpgrade" }],
  "bits-badge-unlocked": [{ event: "channel.bitsBadgeTier" }],
};

const FILTER_OPERATORS: Record<string, ConditionOperator> = {
  is: "eq",
  "is not": "ne",
  "greater than": "gt",
  "greater than or equal to": "gte",
  "less than": "lt",
  "less than or equal to": "lte",
  contains: "contains",
  "starts with": "starts_with",
  "ends with": "ends_with",
  "matches regex": "regex",
};

/** Event filters and the meaning each compares. */
const FILTER_FIELDS: Record<string, EventField> = {
  "firebot:reward": "rewardId",
  "firebot:reward-name": "reward",
  "firebot:cheerbitsamount": "amount",
  "firebot:raid-viewer-count": "viewers",
  "firebot:username": "user",
  "firebot:message-text": "message",
  "firebot:gift-count": "amount",
  "firebot:sub-type": "tier",
  "firebot:sub-months": "months",
};

type FilterResult = { kind: "condition"; condition: ConditionConfig } | { kind: "sub-kind"; resub: boolean } | null;

function convertFilter(filter: JsonRecord, context: EventContext): FilterResult {
  const type = asString(filter.type);
  const comparison = asString(filter.comparisonType);
  const value = filter.value;
  if (type === "firebot:sub-kind") {
    const kind = asString(value);
    if (kind !== "first" && kind !== "resub") {
      return null;
    }
    const resub = comparison === "is not" ? kind === "first" : kind === "resub";
    return { kind: "sub-kind", resub };
  }
  if (type === "firebot:sub-type" && asString(value) === "Prime") {
    return null;
  }
  const field = FILTER_FIELDS[type];
  const operator = FILTER_OPERATORS[comparison];
  if (field === undefined || operator === undefined) {
    return null;
  }
  const expression = fieldExpression(context, field);
  if (expression === null) {
    return null;
  }
  const filterValue = typeof value === "number" || typeof value === "boolean" ? value : literal(asString(value));
  return { kind: "condition", condition: { field: expression, operator, value: filterValue } };
}

function convertEvent(event: JsonRecord, scope: Omit<Scope, "context" | "notes">, groupActive: boolean): ImportItem[] {
  const id = asString(event.id);
  const sourceId = asString(event.sourceId);
  const eventId = asString(event.eventId);
  const name = asString(event.name) || `${sourceId}:${eventId}`;
  const enabled = asFlag(event.active, true) && groupActive;
  const bindings = sourceId === "twitch" ? TWITCH_EVENTS[eventId] : undefined;
  if (!bindings) {
    return [
      workflowItem(
        {
          key: `firebot:event:${id}`,
          name,
          origin: ORIGIN.event,
          notes: [{ message: `woofx3 has no trigger for Firebot's "${sourceId}:${eventId}" event.`, blocking: true }],
        },
        {
          name,
          description: "",
          enabled: false,
          trigger: { kind: "event", event: "", conditions: [], logic: "and" },
          steps: [],
        }
      ),
    ];
  }

  const filterData = asRecord(event.filterData);
  const filters = asRecords(filterData?.filters);
  const logic: "and" | "or" = asString(filterData?.mode) === "inclusive" ? "or" : "and";
  let resubOnly: boolean | null = null;
  const items: ImportItem[] = [];
  const candidates: { binding: EventBinding; conditions: ConditionConfig[]; notes: ImportNote[] }[] = [];
  for (const binding of bindings) {
    const context = eventContext(binding.event);
    const notes: ImportNote[] = [];
    const conditions: ConditionConfig[] = [];
    for (const filter of filters) {
      const converted = convertFilter(filter, context);
      if (converted === null) {
        pushNote(notes, {
          message: `It filters on "${asString(filter.type)}", which woofx3 cannot check here, so it would run too often.`,
          blocking: true,
        });
      } else if (converted.kind === "sub-kind") {
        resubOnly = converted.resub;
      } else {
        conditions.push(converted.condition);
      }
    }
    if (event.customCooldown === true) {
      pushNote(notes, { message: "Its cooldown is left out; woofx3 runs it every time." });
    }
    candidates.push({ binding, conditions, notes });
  }

  for (const { binding, conditions, notes } of candidates) {
    if (resubOnly !== null && bindings.length > 1 && (binding.event === "channel.resub") !== resubOnly) {
      continue;
    }
    const context = eventContext(binding.event);
    const converted = convertEffectList(event.effects, { ...scope, context, notes });
    const split = bindings.length > 1 && resubOnly === null;
    const itemName = split ? `${name} (${binding.label})` : name;
    // Trigger conditions must all hold. Filters where any one passing is enough
    // go on a branch around the steps instead, below the binding's own
    // conditions, which always have to hold.
    const anyOf = logic === "or" && conditions.length > 1;
    const triggerConditions = anyOf ? (binding.conditions ?? []) : [...(binding.conditions ?? []), ...conditions];
    const steps: ImportStep[] = anyOf
      ? [{ kind: "branch", label: "Filters", conditions, logic: "or", whenTrue: converted, whenFalse: [] }]
      : converted;
    items.push(
      workflowItem(
        {
          key: split ? `firebot:event:${id}:${binding.event}` : `firebot:event:${id}`,
          name: itemName,
          origin: ORIGIN.event,
          notes,
        },
        {
          name: itemName,
          description: `Imported from Firebot. ${context.label}.`,
          enabled,
          trigger: { kind: "event", event: binding.event, conditions: triggerConditions, logic: "and" },
          steps: converted.length === 0 ? [] : steps,
        }
      )
    );
  }
  return items;
}

function convertTimer(timer: JsonRecord, scope: Omit<Scope, "context" | "notes">): ImportItem {
  const id = asString(timer.id);
  const name = asString(timer.name) || "Timer";
  const notes: ImportNote[] = [];
  const interval = asNumber(timer.interval);
  if ((asNumber(timer.requiredChatLines) ?? 0) > 0) {
    pushNote(notes, {
      message: "It runs on its interval even when chat is quiet; woofx3 timers do not count chat lines.",
    });
  }
  if (timer.onlyWhenLive === true) {
    pushNote(notes, { message: "It also runs while you are offline; woofx3 schedules cannot require a live stream." });
  }
  if (interval === null || interval <= 0) {
    pushNote(notes, { message: "It has no interval to run on.", blocking: true });
  }
  return workflowItem(
    { key: `firebot:timer:${id}`, name, origin: ORIGIN.timer, notes },
    {
      name,
      description: `Imported from Firebot. Runs every ${interval ?? 0} seconds.`,
      enabled: asFlag(timer.active, true),
      trigger: { kind: "schedule", schedule: `@every ${Math.max(1, Math.round(interval ?? 0))}s` },
      steps: convertEffectList(timer.effects, { ...scope, context: SCHEDULE_CONTEXT, notes }),
    }
  );
}

function convertScheduledTask(task: JsonRecord, scope: Omit<Scope, "context" | "notes">): ImportItem {
  const id = asString(task.id);
  const name = asString(task.name) || "Scheduled task";
  const notes: ImportNote[] = [];
  const schedule = asString(task.schedule).trim();
  if (schedule.split(/\s+/).length !== 5) {
    pushNote(notes, { message: `Its schedule "${schedule}" is not one woofx3 can read.`, blocking: true });
  }
  if (task.onlyWhenLive === true) {
    pushNote(notes, { message: "It also runs while you are offline; woofx3 schedules cannot require a live stream." });
  }
  return workflowItem(
    { key: `firebot:scheduled-task:${id}`, name, origin: ORIGIN.scheduledTask, notes },
    {
      name,
      description: `Imported from Firebot. Runs on the schedule ${schedule}.`,
      enabled: asFlag(task.enabled, true),
      trigger: { kind: "schedule", schedule },
      steps: convertEffectList(task.effects, { ...scope, context: SCHEDULE_CONTEXT, notes }),
    }
  );
}

function convertCounter(counter: JsonRecord, key: string, usedIds: Set<string>): ImportItem {
  const name = asString(counter.name) || "Counter";
  const notes: ImportNote[] = [];
  if (asNumber(counter.minimum) !== null || asNumber(counter.maximum) !== null) {
    pushNote(notes, { message: "Its minimum and maximum are left out; woofx3 counters are not capped." });
  }
  const changeEffects = [counter.updateEffects, counter.minimumEffects, counter.maximumEffects];
  if (changeEffects.some((list) => asRecords(asRecord(list)?.list).length > 0)) {
    pushNote(notes, {
      message: "What it did when it changed is not imported; add a workflow on its Counter changed trigger.",
    });
  }
  if (counter.saveToTxtFile === true) {
    pushNote(notes, { message: "It is no longer written to a text file; show it with a counter widget instead." });
  }
  let resourceInstanceId = resourceIdFromName(name) || "counter";
  for (let suffix = 2; usedIds.has(resourceInstanceId); suffix++) {
    resourceInstanceId = `${resourceIdFromName(name) || "counter"}_${suffix}`;
  }
  usedIds.add(resourceInstanceId);
  return {
    key,
    name,
    origin: ORIGIN.counter,
    notes,
    kind: "counter",
    spec: { resourceInstanceId, displayName: name, initialValue: asNumber(counter.value) ?? 0 },
  };
}

function roleMembers(role: JsonRecord): string[] {
  return asArray(role.viewers)
    .map((viewer) => (typeof viewer === "string" ? viewer : asString(asRecord(viewer)?.username)))
    .map((username) => username.trim().toLowerCase())
    .filter((username) => username !== "");
}

const LEFTOVER_COMPONENTS: { key: string; origin: string; message: string }[] = [
  { key: "currencies", origin: "Firebot currency", message: "woofx3 has no currencies." },
  { key: "quickActions", origin: "Firebot quick action", message: "Recreate it as a macro on your dashboard." },
  {
    key: "hotkeys",
    origin: "Firebot hotkey",
    message: "woofx3 has no hotkeys; a Stream Deck or dashboard macro can run a workflow instead.",
  },
  {
    key: "overlayWidgetConfigs",
    origin: "Firebot overlay widget",
    message: "Rebuild it as a widget in a woofx3 scene.",
  },
  { key: "viewerRankLadders", origin: "Firebot rank ladder", message: "woofx3 has no viewer ranks." },
  { key: "variableMacros", origin: "Firebot variable macro", message: "woofx3 has no variable macros." },
];

export function convertFirebot(document: FirebotDocument): ImportPlan {
  const components = document.components;
  const items: ImportItem[] = [];
  const leftovers: ImportLeftover[] = [];

  const presets = new Map<string, JsonRecord>();
  for (const preset of asCollection(components.presetEffectLists)) {
    presets.set(asString(preset.id), preset);
  }

  const counters = new Map<string, string>();
  const usedCounterIds = new Set<string>();
  for (const counter of asCollection(components.counters)) {
    const key = `firebot:counter:${asString(counter.id)}`;
    counters.set(asString(counter.id), key);
    items.push(convertCounter(counter, key, usedCounterIds));
  }

  const roleKeys = new Map<string, string>();
  for (const role of asCollection(components.viewerRoles)) {
    const id = asString(role.id);
    const name = asString(role.name) || "Imported role";
    const key = `firebot:role:${id}`;
    roleKeys.set(id, key);
    items.push({
      key,
      name,
      origin: ORIGIN.role,
      notes: [],
      kind: "group",
      spec: { name, description: "Imported from Firebot.", members: roleMembers(role) },
    });
  }

  const scope = { presets, counters, presetArgs: {}, depth: 0 };
  for (const command of asCollection(components.commands)) {
    if (asString(command.type) === "system") {
      continue;
    }
    items.push(...convertCommand(command, scope, roleKeys));
  }
  for (const event of asCollection(components.events)) {
    items.push(...convertEvent(event, scope, true));
  }
  for (const group of asCollection(components.eventGroups)) {
    const active = asFlag(group.active, true);
    for (const event of asCollection(group.events)) {
      items.push(...convertEvent(event, scope, active));
    }
  }
  for (const timer of asCollection(components.timers)) {
    items.push(convertTimer(timer, scope));
  }
  for (const task of asCollection(components.scheduledTasks)) {
    items.push(convertScheduledTask(task, scope));
  }

  for (const leftover of LEFTOVER_COMPONENTS) {
    for (const entry of asCollection(components[leftover.key])) {
      leftovers.push({ origin: leftover.origin, name: asString(entry.name) || "Unnamed", message: leftover.message });
    }
  }

  return { source: "firebot", label: document.name || "Firebot setup", items, leftovers };
}
