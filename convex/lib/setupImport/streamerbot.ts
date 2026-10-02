import type { ConditionConfig, ConditionOperator } from "@woofx3/api";
import { commandItems, pushNote, workflowItem } from "./build";
import { CHAT_COMMAND_CONTEXT, type EventContext, eventContext, SCHEDULE_CONTEXT, triggerData } from "./events";
import { asArray, asFlag, asNumber, asRecord, asRecords, asString, commandWord, type JsonRecord } from "./read";
import { translateStreamerbotText, unknownVariablesMessage } from "./templates";
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
 * Streamer.bot (0.2.x and 1.0.x) to woofx3, from the JSON inside an export
 * string (decode.ts).
 *
 * Streamer.bot documents neither the export format nor the numbers it gives
 * trigger and sub-action types. The numbers below were read from real exports
 * of 0.2.2 through 1.0.4, and the trigger numbers checked against the order of
 * the C# EventType enum, which numbers Twitch events consecutively from 101.
 * Numbers marked "by enum order" were not seen in an export.
 *
 * Two layouts exist. Schema 23 (1.0.x) nests sub-actions: `subActions`, with an
 * if/else holding its two branches as sub-actions of type 99901 and 99902, and
 * a group (99900) holding its own. Older schemas keep a flat `actions` list in
 * which a sub-action may name a group from `actionGroups`, and an if/else runs
 * other actions rather than holding branches.
 */

export interface StreamerbotDocument {
  name: string;
  export: JsonRecord;
}

const ORIGIN = {
  action: "Streamer.bot action",
  command: "Streamer.bot command",
  timer: "Streamer.bot timed action",
  group: "Streamer.bot user group",
} as const;

const TRIGGER = {
  follow: 101,
  cheer: 102,
  sub: 103,
  resub: 104,
  giftSub: 105,
  giftBomb: 106,
  raid: 107,
  hypeTrainStart: 108,
  rewardRedemption: 112,
  chatMessage: 133,
  /** By enum order. */
  announcement: 137,
  /** By enum order. */
  adRun: 138,
  /** By enum order. */
  charityDonation: 140,
  streamOnline: 154,
  /** By enum order: the event declared after StreamOnline. */
  streamOffline: 155,
  upcomingAd: 186,
  command: 401,
  timedAction: 701,
  test: 702,
} as const;

const SUB_ACTION = {
  playSound: 1,
  runAction: 4,
  sendMessage: 10,
  obsSourceVisibility: 30,
  ifElse: 120,
  delay: 1002,
  comment: 1009,
  group: 99900,
  trueBranch: 99901,
  falseBranch: 99902,
  csharpMethod: 99998,
  csharpCode: 99999,
} as const;

/** Names for sub-actions woofx3 has no equivalent of, as the report shows them. */
const SUB_ACTION_NAMES: Record<number, string> = {
  [SUB_ACTION.playSound]: "Play Sound",
  8: "Set Timer State",
  9: "Set Command State",
  13: "Set Chat Mode",
  14: "Set Chat Mode",
  16: "Set Stream Category",
  19: "Run Ad",
  22: "Get Random Viewer",
  39: "Set OBS Text",
  46: "Run Script",
  50: "Get User Info",
  51: "Get User Info",
  52: "Get User Info",
  121: "Get Global Variable",
  122: "Set Global Variable",
  123: "Set Argument",
  124: "Break",
  128: "While",
  553: "Add User to Group",
  558: "Remove User from Group",
  602: "Speaker.bot TTS",
  1003: "Get Random Number",
  1006: "Read File",
  1007: "Fetch URL",
  1012: "Keyboard Press",
  1023: "Input Dialog",
  1024: "Show Toast",
  7001: "Discord Webhook",
  11001: "Stream Deck",
  [SUB_ACTION.csharpMethod]: "Execute C# Method",
  [SUB_ACTION.csharpCode]: "Execute C# Code",
};

/** Event triggers that have no woofx3 equivalent, by name. */
const TRIGGER_NAMES: Record<number, string> = {
  109: "Hype Train Update",
  110: "Hype Train Level Up",
  111: "Hype Train End",
  118: "Stream Update",
  119: "Whisper",
  120: "First Words",
  122: "Broadcast Update",
  124: "Present Viewers",
};

/** Streamer.bot's if/else operations, by number. */
const OPERATIONS: Record<number, ConditionOperator> = {
  0: "eq",
  1: "ne",
  2: "contains",
  3: "regex",
  4: "lt",
  5: "gt",
};

const MAX_RUN_DEPTH = 8;

interface Library {
  actions: Map<string, JsonRecord>;
  /** Ids of actions some other action runs. */
  runTargets: Set<string>;
}

interface Scope {
  library: Library;
  context: EventContext;
  depth: number;
  notes: ImportNote[];
}

function text(value: unknown, scope: Scope): string {
  const translated = translateStreamerbotText(asString(value), scope.context);
  if (translated.unknown.length > 0) {
    pushNote(scope.notes, { message: unknownVariablesMessage(translated.unknown) });
  }
  return translated.text;
}

function byIndex(entries: JsonRecord[]): JsonRecord[] {
  return [...entries].sort((a, b) => (asNumber(a.index) ?? 0) - (asNumber(b.index) ?? 0));
}

/**
 * An action's sub-actions as one ordered tree, in the 1.0.x shape. Older
 * schemas' flat list becomes its ungrouped sub-actions and its groups, ordered
 * together by index, each group holding its own members.
 */
function subActionsOf(action: JsonRecord): JsonRecord[] {
  if (Array.isArray(action.subActions)) {
    return byIndex(asRecords(action.subActions));
  }
  const flat = asRecords(action.actions);
  const groups = asRecords(action.actionGroups);
  const top: JsonRecord[] = flat.filter((sub) => asString(sub.group) === "");
  for (const group of groups) {
    const name = asString(group.name);
    top.push({
      type: SUB_ACTION.group,
      name,
      random: group.random === true,
      index: group.index,
      enabled: true,
      subActions: flat.filter((sub) => asString(sub.group) === name),
    });
  }
  return byIndex(top);
}

function runAction(actionId: string, scope: Scope): ImportStep[] {
  const target = scope.library.actions.get(actionId);
  if (!target) {
    pushNote(scope.notes, { message: "Runs an action that is not in this export, so that part is left out." });
    return [];
  }
  if (scope.depth >= MAX_RUN_DEPTH) {
    pushNote(scope.notes, { message: "Actions run each other too deeply; the innermost are left out." });
    return [];
  }
  return convertSubActions(subActionsOf(target), { ...scope, depth: scope.depth + 1 });
}

const SINGLE_EXPRESSION = /^\$\{[^}]+\}$/;

function ifElseCondition(input: string, operation: unknown, value: unknown, scope: Scope): ConditionConfig | null {
  const operator = OPERATIONS[asNumber(operation) ?? -1];
  const field = text(input, scope);
  const compared = text(value, scope);
  if (operator === undefined || !SINGLE_EXPRESSION.test(field) || compared.includes("${")) {
    return null;
  }
  const number = asNumber(compared);
  return { field, operator, value: number === null ? compared : number };
}

function convertIfElse(sub: JsonRecord, scope: Scope): ImportStep[] {
  // 1.0.x reads its input as a whole template; older versions name a variable.
  const input = typeof sub.input === "string" ? sub.input : `%${asString(sub.variableName)}%`;
  const condition = ifElseCondition(input, sub.operation, sub.value, scope);
  if (!condition) {
    pushNote(scope.notes, { message: "Leaves out an If/Else whose comparison woofx3 cannot check." });
    return [];
  }
  let whenTrue: ImportStep[];
  let whenFalse: ImportStep[];
  if (Array.isArray(sub.subActions)) {
    const branches = asRecords(sub.subActions);
    const branch = (type: number) => {
      const found = branches.find((entry) => asNumber(entry.type) === type);
      return found ? convertSubActions(byIndex(asRecords(found.subActions)), scope) : [];
    };
    whenTrue = branch(SUB_ACTION.trueBranch);
    whenFalse = branch(SUB_ACTION.falseBranch);
  } else {
    const actionId = asString(sub.actionId);
    const elseActionId = asString(sub.elseActionId);
    whenTrue = actionId === "" ? [] : runAction(actionId, scope);
    whenFalse = elseActionId === "" ? [] : runAction(elseActionId, scope);
  }
  return [{ kind: "branch", label: "If/else", conditions: [condition], logic: "and", whenTrue, whenFalse }];
}

function decodedCode(byteCode: unknown): string | undefined {
  const encoded = asString(byteCode);
  if (encoded === "") {
    return undefined;
  }
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function dropSubAction(sub: JsonRecord, type: number, scope: Scope): ImportStep[] {
  if (type === SUB_ACTION.csharpCode) {
    const name = asString(sub.name);
    pushNote(scope.notes, {
      message: `Leaves out C# code${name ? ` "${name}"` : ""}; woofx3 cannot run C#. Its source is below if you want to rebuild it.`,
      detail: decodedCode(sub.byteCode),
    });
    return [];
  }
  const name = SUB_ACTION_NAMES[type];
  pushNote(scope.notes, {
    message: name
      ? `Leaves out the ${name} sub-action, which woofx3 cannot run yet.`
      : `Leaves out a sub-action woofx3 cannot run yet (Streamer.bot type ${type}).`,
  });
  return [];
}

function convertSubAction(sub: JsonRecord, scope: Scope): ImportStep[] {
  const type = asNumber(sub.type) ?? -1;
  switch (type) {
    case SUB_ACTION.sendMessage:
      return [
        {
          kind: "action",
          label: "Send chat message",
          ref: IMPORT_ACTION_REFS.chatReply,
          parameters: { message: text(sub.text, scope) },
        },
      ];
    case SUB_ACTION.delay: {
      const ms = asNumber(sub.value);
      if (ms === null || ms <= 0) {
        pushNote(scope.notes, { message: "Leaves out a delay whose length is worked out from variables." });
        return [];
      }
      if (sub.random === true) {
        pushNote(scope.notes, { message: "Its random delay always waits the shortest time it allowed." });
      }
      return [{ kind: "delay", label: `Wait ${ms / 1000}s`, ms: Math.round(ms) }];
    }
    case SUB_ACTION.runAction:
      return runAction(asString(sub.actionId), scope);
    case SUB_ACTION.group:
      if (sub.random === true) {
        pushNote(scope.notes, {
          message: "Leaves out a group that runs one sub-action at random; woofx3 cannot pick one.",
        });
        return [];
      }
      return convertSubActions(byIndex(asRecords(sub.subActions)), scope);
    case SUB_ACTION.ifElse:
      return convertIfElse(sub, scope);
    case SUB_ACTION.obsSourceVisibility: {
      const state = asNumber(sub.state);
      if (state !== 0 && state !== 1) {
        pushNote(scope.notes, { message: "Leaves out toggling an OBS source, which woofx3 can only show or hide." });
        return [];
      }
      return [
        {
          kind: "action",
          label: state === 0 ? "Show OBS source" : "Hide OBS source",
          ref: IMPORT_ACTION_REFS.sourceVisibility,
          parameters: {
            sourceName: text(sub.sourceName, scope),
            visible: state === 0,
            sceneName: text(sub.sceneName, scope),
          },
        },
      ];
    }
    case SUB_ACTION.comment:
      return [];
    default:
      return dropSubAction(sub, type, scope);
  }
}

function convertSubActions(subs: JsonRecord[], scope: Scope): ImportStep[] {
  const steps: ImportStep[] = [];
  for (const sub of subs) {
    if (sub.enabled === false) {
      continue;
    }
    steps.push(...convertSubAction(sub, scope));
  }
  return steps;
}

function actionSteps(action: JsonRecord, scope: Omit<Scope, "depth">): ImportStep[] {
  if (action.randomAction === true) {
    pushNote(scope.notes, {
      message: `"${asString(action.name)}" runs one sub-action at random; woofx3 cannot pick one, so it is left out.`,
    });
    return [];
  }
  return convertSubActions(subActionsOf(action), { ...scope, depth: 0 });
}

interface EventBinding {
  event: string;
  label: string;
  conditions: ConditionConfig[];
  note?: string;
}

function range(trigger: JsonRecord, path: string): ConditionConfig[] {
  const conditions: ConditionConfig[] = [];
  const min = asNumber(trigger.min);
  const max = asNumber(trigger.max);
  if (min !== null && min > 0) {
    conditions.push({ field: triggerData(path), operator: "gte", value: min });
  }
  if (max !== null && max >= 0) {
    conditions.push({ field: triggerData(path), operator: "lte", value: max });
  }
  return conditions;
}

function eventBinding(trigger: JsonRecord): EventBinding | null {
  const type = asNumber(trigger.type);
  switch (type) {
    case TRIGGER.follow:
      return { event: "channel.follow", label: "Follow", conditions: [] };
    case TRIGGER.cheer:
      return { event: "channel.cheer", label: "Cheer", conditions: range(trigger, "amount") };
    case TRIGGER.sub:
      return {
        event: "channel.subscribe",
        label: "Sub",
        conditions: [{ field: triggerData("isGift"), operator: "eq", value: false }],
      };
    case TRIGGER.resub:
      return { event: "channel.resub", label: "Resub", conditions: [] };
    case TRIGGER.giftSub:
      return {
        event: "channel.subscriptionGift",
        label: "Gift Sub",
        conditions: [{ field: triggerData("amount"), operator: "eq", value: 1 }],
        note: "Runs once for each single gifted sub; Streamer.bot also ran it for every sub in a gift bomb.",
      };
    case TRIGGER.giftBomb:
      return { event: "channel.subscriptionGift", label: "Gift Bomb", conditions: range(trigger, "amount") };
    case TRIGGER.raid:
      return { event: "channel.raid", label: "Raid", conditions: range(trigger, "viewers") };
    case TRIGGER.hypeTrainStart:
      return { event: "channel.hypetrain", label: "Hype Train Start", conditions: [] };
    case TRIGGER.rewardRedemption: {
      const rewardId = asString(trigger.rewardId);
      return {
        event: "channelpoints.redeem",
        label: "Reward Redemption",
        conditions: rewardId === "" ? [] : [{ field: triggerData("rewardId"), operator: "eq", value: rewardId }],
      };
    }
    case TRIGGER.chatMessage:
      return { event: "user.message", label: "Chat Message", conditions: [] };
    case TRIGGER.announcement:
      return { event: "channel.announcement", label: "Announcement", conditions: [] };
    case TRIGGER.adRun:
      return { event: "channel.ad_break.begin", label: "Ad Run", conditions: [] };
    case TRIGGER.charityDonation:
      return { event: "channel.charityDonation", label: "Charity Donation", conditions: [] };
    case TRIGGER.streamOnline:
      return { event: "stream.online", label: "Stream Online", conditions: [] };
    case TRIGGER.streamOffline:
      return { event: "stream.offline", label: "Stream Offline", conditions: [] };
    case TRIGGER.upcomingAd:
      return { event: "channel.ad_break.upcoming", label: "Upcoming Ad", conditions: [] };
    default:
      return null;
  }
}

const BUILT_IN_GROUPS: Record<string, "broadcaster" | "moderator"> = {
  moderators: "moderator",
  broadcaster: "broadcaster",
};

const UNSUPPORTED_GROUPS = new Set([
  "vips",
  "subscribers",
  "subscriber tier 1",
  "subscriber tier 2",
  "subscriber tier 3",
]);

function groupKey(name: string): string {
  return `streamerbot:group:${name.toLowerCase()}`;
}

/**
 * Who may use a command. Streamer.bot lets everyone in when neither users nor
 * groups are set. A group woofx3 cannot gate on (VIPs, subscribers) is never
 * widened to everyone: the command keeps the groups that can be expressed,
 * falling back to the broadcaster and moderators.
 */
function commandAccess(command: JsonRecord, groups: Map<string, string>, notes: ImportNote[]): CommandAccess {
  const access: CommandAccess = { builtIn: [], groupKeys: [], usernames: [] };
  for (const user of asArray(command.permittedUsers).map(asString)) {
    const username = user.trim().toLowerCase();
    if (username !== "") {
      access.usernames.push(username);
    }
  }
  const dropped: string[] = [];
  for (const group of asArray(command.permittedGroups).map(asString)) {
    const lower = group.trim().toLowerCase();
    const builtIn = BUILT_IN_GROUPS[lower];
    if (builtIn !== undefined) {
      access.builtIn.push(builtIn);
    } else if (UNSUPPORTED_GROUPS.has(lower)) {
      dropped.push(group);
    } else if (lower !== "") {
      groups.set(groupKey(group), group);
      access.groupKeys.push(groupKey(group));
    }
  }
  if (dropped.length > 0) {
    const restricted = access.builtIn.length + access.groupKeys.length + access.usernames.length > 0;
    if (!restricted) {
      access.builtIn.push("broadcaster", "moderator");
    }
    pushNote(notes, {
      message: `It was open to ${dropped.join(" and ")}, which woofx3 commands cannot check; ${
        restricted
          ? "the other groups it allowed keep it"
          : "only you and your moderators can use it until you change that"
      }.`,
    });
  }
  access.builtIn = Array.from(new Set(access.builtIn));
  return access;
}

function linkedActions(actions: JsonRecord[], triggerType: number, idField: string): Map<string, JsonRecord[]> {
  const linked = new Map<string, JsonRecord[]>();
  for (const action of actions) {
    for (const trigger of asRecords(action.triggers)) {
      if (asNumber(trigger.type) !== triggerType || trigger.enabled === false) {
        continue;
      }
      const id = asString(trigger[idField]);
      linked.set(id, [...(linked.get(id) ?? []), action]);
    }
  }
  return linked;
}

/** Twitch's bit in a 1.0.x command's `sources` flags; 0.2.x listed sources in an array. */
const TWITCH_SOURCE = 1;

function convertCommand(
  command: JsonRecord,
  actions: JsonRecord[],
  library: Library,
  groups: Map<string, string>
): ImportItem[] {
  const id = asString(command.id);
  const notes: ImportNote[] = [];
  const words = asString(command.command)
    .split(/\r?\n/)
    .map((word) => word.trim())
    .filter((word) => word !== "");
  const name = words[0] ?? asString(command.name);
  const base = { key: `streamerbot:command:${id}`, name: name || "Unnamed command", origin: ORIGIN.command, notes };

  if (asNumber(command.mode) === 1) {
    pushNote(notes, {
      message: "It is matched by a regular expression; woofx3 commands match a word.",
      blocking: true,
    });
  }
  if ((asNumber(command.location) ?? 0) !== 0) {
    pushNote(notes, { message: "It only runs when the message starts with the command, not anywhere in it." });
  }
  if ((asNumber(command.userCooldown) ?? 0) > 0) {
    pushNote(notes, { message: "Its per-user cooldown is left out; the shared cooldown still applies." });
  }
  const sources = asNumber(command.sources);
  if (sources !== null && sources !== 0 && (sources & TWITCH_SOURCE) === 0) {
    pushNote(notes, { message: "It was set up for another platform; on woofx3 it runs in Twitch chat." });
  }
  const access = commandAccess(command, groups, notes);
  const steps = actions.flatMap((action) => actionSteps(action, { library, context: CHAT_COMMAND_CONTEXT, notes }));
  const enabled = asFlag(command.enabled, true) && actions.some((action) => asFlag(action.enabled, true));

  const items: ImportItem[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of words.entries()) {
    const word = commandWord(raw);
    if (word === null) {
      if (index === 0) {
        pushNote(notes, { message: `"${raw}" is not a command word woofx3 can match.`, blocking: true });
      }
      continue;
    }
    if (seen.has(word)) {
      continue;
    }
    seen.add(word);
    const itemBase =
      items.length === 0
        ? base
        : { key: `${base.key}:alias:${word}`, name: `!${word}`, origin: ORIGIN.command, notes: [...notes] };
    items.push(
      ...commandItems(
        itemBase,
        { command: word, enabled, cooldown: Math.max(0, asNumber(command.globalCooldown) ?? 0), access },
        steps
      )
    );
  }
  if (items.length === 0) {
    pushNote(notes, { message: "It has no command word woofx3 can match.", blocking: true });
    items.push({
      ...base,
      kind: "command",
      spec: { command: name, enabled: false, cooldown: 0, access, steps: [] },
    });
  }
  return items;
}

function convertTimer(timer: JsonRecord, actions: JsonRecord[], library: Library): ImportItem {
  const id = asString(timer.id);
  const name = asString(timer.name) || "Timed action";
  const notes: ImportNote[] = [];
  const interval = asNumber(timer.interval);
  if (timer.repeat === false) {
    pushNote(notes, {
      message: "It runs once rather than repeating, which woofx3 schedules cannot do.",
      blocking: true,
    });
  }
  if (timer.randomInterval === true) {
    pushNote(notes, { message: "It runs on its fixed interval; woofx3 schedules cannot pick a random one." });
  }
  if ((asNumber(timer.lines) ?? 0) > 0) {
    pushNote(notes, {
      message: "It runs on its interval even when chat is quiet; woofx3 timers do not count chat lines.",
    });
  }
  if (interval === null || interval <= 0) {
    pushNote(notes, { message: "It has no interval to run on.", blocking: true });
  }
  const steps = actions.flatMap((action) => actionSteps(action, { library, context: SCHEDULE_CONTEXT, notes }));
  return workflowItem(
    { key: `streamerbot:timer:${id}`, name, origin: ORIGIN.timer, notes },
    {
      name,
      description: `Imported from Streamer.bot. Runs every ${interval ?? 0} seconds.`,
      enabled: asFlag(timer.enabled, true) && actions.some((action) => asFlag(action.enabled, true)),
      trigger: { kind: "schedule", schedule: `@every ${Math.max(1, Math.round(interval ?? 0))}s` },
      steps,
    }
  );
}

function convertActionTriggers(action: JsonRecord, library: Library): { items: ImportItem[]; triggered: boolean } {
  const id = asString(action.id);
  const name = asString(action.name) || "Unnamed action";
  const triggers = asRecords(action.triggers).filter((trigger) => trigger.enabled !== false);
  const bindings: { trigger: JsonRecord; binding: EventBinding }[] = [];
  const unsupported: string[] = [];
  let triggered = false;
  for (const trigger of triggers) {
    const type = asNumber(trigger.type) ?? -1;
    if (type === TRIGGER.command || type === TRIGGER.timedAction) {
      triggered = true;
      continue;
    }
    if (type === TRIGGER.test) {
      continue;
    }
    triggered = true;
    const binding = eventBinding(trigger);
    if (binding) {
      bindings.push({ trigger, binding });
    } else {
      unsupported.push(TRIGGER_NAMES[type] ?? `type ${type}`);
    }
  }

  const items: ImportItem[] = [];
  for (const { trigger, binding } of bindings) {
    const notes: ImportNote[] = [];
    if (binding.note) {
      pushNote(notes, { message: binding.note });
    }
    const context = eventContext(binding.event);
    const steps = actionSteps(action, { library, context, notes });
    const itemName = bindings.length > 1 ? `${name} (${binding.label})` : name;
    items.push(
      workflowItem(
        {
          key: `streamerbot:action:${id}:trigger:${asString(trigger.id)}`,
          name: itemName,
          origin: ORIGIN.action,
          notes,
        },
        {
          name: itemName,
          description: `Imported from Streamer.bot. ${context.label}.`,
          enabled: asFlag(action.enabled, true),
          trigger: { kind: "event", event: binding.event, conditions: binding.conditions, logic: "and" },
          steps,
        }
      )
    );
  }
  if (unsupported.length > 0) {
    const notes: ImportNote[] = [
      {
        message: `woofx3 has no trigger like Streamer.bot's ${Array.from(new Set(unsupported)).join(", ")}.`,
        blocking: true,
      },
    ];
    items.push(
      workflowItem(
        { key: `streamerbot:action:${id}:unsupported`, name, origin: ORIGIN.action, notes },
        {
          name,
          description: "",
          enabled: false,
          trigger: { kind: "event", event: "", conditions: [], logic: "and" },
          steps: [],
        }
      )
    );
  }
  return { items, triggered };
}

function collectRunTargets(subs: JsonRecord[], into: Set<string>): void {
  for (const sub of subs) {
    const type = asNumber(sub.type);
    if (type === SUB_ACTION.runAction) {
      into.add(asString(sub.actionId));
    }
    if (type === SUB_ACTION.ifElse) {
      into.add(asString(sub.actionId));
      into.add(asString(sub.elseActionId));
    }
    collectRunTargets(asRecords(sub.subActions), into);
  }
}

export function convertStreamerbot(document: StreamerbotDocument): ImportPlan {
  const data = asRecord(document.export.data) ?? {};
  const actions = asRecords(data.actions);
  const library: Library = { actions: new Map(), runTargets: new Set() };
  for (const action of actions) {
    library.actions.set(asString(action.id), action);
    collectRunTargets(subActionsOf(action), library.runTargets);
  }

  const items: ImportItem[] = [];
  const leftovers: ImportLeftover[] = [];
  const groups = new Map<string, string>();

  const byCommand = linkedActions(actions, TRIGGER.command, "commandId");
  const commandItemsList: ImportItem[] = [];
  for (const command of asRecords(data.commands)) {
    const linked = byCommand.get(asString(command.id)) ?? [];
    if (linked.length === 0) {
      leftovers.push({
        origin: ORIGIN.command,
        name: asString(command.command).split(/\r?\n/)[0] || asString(command.name),
        message: "No action runs it, so there is nothing to import.",
      });
      continue;
    }
    commandItemsList.push(...convertCommand(command, linked, library, groups));
  }

  const byTimer = linkedActions(actions, TRIGGER.timedAction, "timerId");
  const timerItems: ImportItem[] = [];
  for (const timer of asRecords(data.timers)) {
    const linked = byTimer.get(asString(timer.id)) ?? [];
    if (linked.length === 0) {
      continue;
    }
    timerItems.push(convertTimer(timer, linked, library));
  }

  const actionItems: ImportItem[] = [];
  for (const action of actions) {
    const { items: converted, triggered } = convertActionTriggers(action, library);
    actionItems.push(...converted);
    if (!triggered && !library.runTargets.has(asString(action.id)) && asFlag(action.enabled, true)) {
      leftovers.push({
        origin: ORIGIN.action,
        name: asString(action.name) || "Unnamed action",
        message: "Nothing triggers it; it only runs when started by hand. Recreate it as a dashboard macro.",
      });
    }
  }

  for (const [key, name] of groups) {
    items.push({
      key,
      name,
      origin: ORIGIN.group,
      notes: [{ message: "Streamer.bot keeps group members outside its exports; add them on woofx3." }],
      kind: "group",
      spec: { name, description: "Imported from Streamer.bot.", members: [] },
    });
  }
  items.push(...commandItemsList, ...timerItems, ...actionItems);

  const meta = asRecord(document.export.meta) ?? {};
  return {
    source: "streamerbot",
    label: asString(meta.name) || document.name || "Streamer.bot export",
    items,
    leftovers,
  };
}
