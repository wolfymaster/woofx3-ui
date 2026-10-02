/**
 * What an imported step can say about the event that ran it.
 *
 * Firebot and Streamer.bot each name event data their own way ($cheerBitsAmount,
 * %bits%). Each converter maps its names onto these meanings, and each woofx3
 * event says where a meaning lives in its payload, so a variable resolves only
 * where the event really carries it. Paths must match the `emits` fields of the
 * module manifests that declare the events (woofx3_twitch, and the engine's
 * ChatCommandEventData for chat commands).
 */
export type EventField =
  | "user"
  | "userId"
  | "message"
  | "amount"
  | "months"
  | "streak"
  | "viewers"
  | "reward"
  | "rewardId"
  | "tier"
  | "gifter"
  | "text"
  | "command"
  | "seconds";

export interface EventContext {
  /** How the report names the event. */
  label: string;
  fields: Partial<Record<EventField, string>>;
  /** Chat commands also carry their arguments, as `args[0]`, `args[1]` and so on. */
  hasArgs?: boolean;
}

/** The event a chat command publishes and runs its actions against. */
export const CHAT_COMMAND_CONTEXT: EventContext = {
  label: "A chat command",
  fields: { user: "chatter", message: "rawMessage", text: "text", command: "command" },
  hasArgs: true,
};

/** A schedule fires with no event data at all. */
export const SCHEDULE_CONTEXT: EventContext = { label: "On a schedule", fields: {} };

/** woofx3 events an import can bind to, by subject. */
export const EVENT_CONTEXTS: Record<string, EventContext> = {
  "channel.follow": { label: "Someone follows", fields: { user: "userName" } },
  "channel.subscribe": {
    label: "Someone subscribes",
    fields: { user: "userName", userId: "userId", tier: "tier" },
  },
  "channel.resub": {
    label: "Someone shares a resub",
    fields: {
      user: "chatterName",
      userId: "chatterId",
      months: "cumulativeMonths",
      streak: "streakMonths",
      message: "messageText",
      tier: "tier",
    },
  },
  "channel.subscriptionGift": {
    label: "Someone gifts subs",
    fields: { user: "gifterName", userId: "gifterId", gifter: "gifterName", amount: "amount", tier: "tier" },
  },
  "channel.cheer": {
    label: "Someone cheers",
    fields: { user: "userName", userId: "userId", amount: "amount", message: "message" },
  },
  "channel.raid": {
    label: "Someone raids",
    fields: { user: "fromBroadcasterUserName", userId: "fromBroadcasterUserId", viewers: "viewers" },
  },
  "channelpoints.redeem": {
    label: "Someone redeems a channel point reward",
    fields: { user: "userName", userId: "userId", reward: "rewardTitle", rewardId: "rewardId", message: "message" },
  },
  "user.message": {
    label: "Someone chats",
    fields: { user: "chatterName", userId: "chatterId", message: "message", text: "message" },
  },
  "stream.online": { label: "The stream goes live", fields: {} },
  "stream.offline": { label: "The stream goes offline", fields: {} },
  "channel.hypetrain": { label: "A hype train", fields: {} },
  "channel.ad_break.upcoming": { label: "An ad break is coming up", fields: { seconds: "secondsUntil" } },
  "channel.ad_break.begin": { label: "An ad break starts", fields: { seconds: "durationSeconds" } },
  "channel.ad_break.end": { label: "An ad break ends", fields: { seconds: "durationSeconds" } },
  "channel.charityDonation": {
    label: "Someone donates to charity",
    fields: { user: "chatterName", userId: "chatterId", amount: "amount" },
  },
  "channel.announcement": {
    label: "An announcement",
    fields: { user: "chatterName", userId: "chatterId", message: "messageText" },
  },
  "channel.watchStreak": {
    label: "Someone shares a watch streak",
    fields: { user: "chatterName", userId: "chatterId", streak: "streakCount" },
  },
  "channel.primePaidUpgrade": {
    label: "Someone upgrades a Prime sub",
    fields: { user: "chatterName", userId: "chatterId", tier: "tier" },
  },
  "channel.giftPaidUpgrade": {
    label: "Someone keeps a gifted sub",
    fields: { user: "chatterName", userId: "chatterId", gifter: "gifterName" },
  },
  "channel.bitsBadgeTier": {
    label: "Someone unlocks a bits badge",
    fields: { user: "chatterName", userId: "chatterId", amount: "newTier" },
  },
};

export function eventContext(event: string): EventContext {
  const context = EVENT_CONTEXTS[event];
  if (!context) {
    throw new Error(`No import context for event ${event}`);
  }
  return context;
}

/** `${trigger.data.<path>}`: where a field of the running event is read. */
export function triggerData(path: string): string {
  return `\${trigger.data.${path}}`;
}

/** The expression for a meaning in a context, or null when the event does not carry it. */
export function fieldExpression(context: EventContext, field: EventField): string | null {
  const path = context.fields[field];
  return path === undefined ? null : triggerData(path);
}

/** A command argument by zero-based position, or null outside a chat command. */
export function argumentExpression(context: EventContext, index: number): string | null {
  if (context.hasArgs !== true || !Number.isInteger(index) || index < 0) {
    return null;
  }
  return triggerData(`args[${index}]`);
}
