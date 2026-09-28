import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, query } from "./_generated/server";
import {
  CAPABILITY_RULES,
  type CapabilityStatus,
  type ChatSettings,
  chatSettingsFromHelix,
  chatSettingsToHelix,
  describeModerationError,
  helixErrorMessage,
  MODERATION_SCOPES,
  type ModerationCapability,
  type ModerationOperation,
  moderationAccess,
  validateBanReason,
  validateBlockedTerm,
  validateTimeoutSeconds,
} from "./lib/moderation";
import { getInstanceMembership } from "./lib/teamAccess";
import { type AuthorizedTwitchCall, authorizeTwitch } from "./lib/twitchAuth";
import { fetchTwitchUser, normalizeTwitchLogin, type TwitchUser } from "./lib/twitchUsers";

// Moderation for the dashboard widget: blocked terms, timeouts and bans, and
// chat lockdown modes. Straight to Helix with the broadcaster's token, the same
// shape as convex/twitchBroadcast.ts: the engine exposes no moderation methods,
// and these are one-shot calls a streamer makes by hand mid-stream.
//
// Who may do what is decided by CAPABILITY_RULES in convex/lib/moderation.ts;
// every action enforces it here, and the widget reads the same rules through
// `access` only to disable and explain.
//
// Refusals are ConvexErrors carrying the sentence to show: a plain Error's
// message is replaced by "Server Error" in production, and a streamer
// mid-raid needs "can't ban a moderator", not a request id.

const HELIX = "https://api.twitch.tv/helix";
const BLOCKED_TERMS_URL = `${HELIX}/moderation/blocked_terms`;
const BANS_URL = `${HELIX}/moderation/bans`;
const CHAT_SETTINGS_URL = `${HELIX}/chat/settings`;

const BLOCKED_TERMS_PAGE_SIZE = 100;
/** A bound on the pagination loop. A channel past this many terms sees the first 2000. */
const BLOCKED_TERMS_MAX_PAGES = 20;

const ROLE_REFUSALS: Record<ModerationCapability, string> = {
  blockedTerms: "You don't have permission to manage blocked terms on this instance",
  timeout: "You don't have permission to time out users on this instance",
  ban: "Only the instance's owners and admins can ban or unban",
  chatSettings: "Only the instance's owners and admins can change chat modes",
};

/** The caller's role on the instance and the instance's granted scopes, checked before any Helix call. */
async function authorizeModeration(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  capability: ModerationCapability
): Promise<AuthorizedTwitchCall> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("Not authenticated");
  }
  const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId, userId });
  if (!membership) {
    throw new ConvexError("Not a member of this instance");
  }
  const rule = CAPABILITY_RULES[capability];
  if (!rule.roles.includes(membership.role)) {
    throw new ConvexError(ROLE_REFUSALS[capability]);
  }
  return authorizeTwitch(ctx, instanceId, rule.scope);
}

/** Query string with the broadcaster acting as its own moderator, which is who the token belongs to. */
function moderationParams(auth: AuthorizedTwitchCall, extra: Record<string, string> = {}): string {
  return new URLSearchParams({
    broadcaster_id: auth.broadcasterUserId,
    moderator_id: auth.broadcasterUserId,
    ...extra,
  }).toString();
}

async function helix(
  auth: AuthorizedTwitchCall,
  operation: ModerationOperation,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown
): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.accessToken}`, "Client-Id": auth.clientId };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ConvexError(describeModerationError(operation, response.status, helixErrorMessage(text)));
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function resolveTarget(auth: AuthorizedTwitchCall, input: string): Promise<TwitchUser> {
  const login = normalizeTwitchLogin(input);
  if (!login) {
    throw new ConvexError(`"${input.trim()}" is not a Twitch username`);
  }
  const user = await fetchTwitchUser(auth, { login });
  if (!user) {
    throw new ConvexError(`No Twitch user called "${login}"`);
  }
  if (user.twitchUserId === auth.broadcasterUserId) {
    throw new ConvexError("You can't moderate your own account");
  }
  return user;
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * What the caller can do right now, per capability. Null for a non-member so
 * the widget renders nothing rather than tearing the dashboard down.
 */
export const access = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<Record<ModerationCapability, CapabilityStatus> | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const membership = await getInstanceMembership(ctx, args.instanceId, userId);
    if (!membership) {
      return null;
    }
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("platform"), "twitch"))
      .first();
    return moderationAccess(membership.role, link ? link.scopes : null);
  },
});

// ---------------------------------------------------------------------------
// Blocked terms
// ---------------------------------------------------------------------------

interface BlockedTerm {
  id: string;
  text: string;
  createdAt: string | null;
  expiresAt: string | null;
}

interface HelixBlockedTermsPage {
  data?: Array<{ id: string; text: string; created_at?: string | null; expires_at?: string | null }>;
  pagination?: { cursor?: string };
}

export const listBlockedTerms = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<{ terms: BlockedTerm[]; truncated: boolean }> => {
    const auth = await authorizeModeration(ctx, args.instanceId, "blockedTerms");

    const terms: BlockedTerm[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < BLOCKED_TERMS_MAX_PAGES; page++) {
      const params = moderationParams(auth, {
        first: String(BLOCKED_TERMS_PAGE_SIZE),
        ...(cursor ? { after: cursor } : {}),
      });
      const body = (await helix(auth, "list-terms", "GET", `${BLOCKED_TERMS_URL}?${params}`)) as HelixBlockedTermsPage;
      for (const term of body.data ?? []) {
        terms.push({
          id: term.id,
          text: term.text,
          createdAt: term.created_at ?? null,
          expiresAt: term.expires_at ?? null,
        });
      }
      cursor = body.pagination?.cursor || undefined;
      if (!cursor) {
        return { terms, truncated: false };
      }
    }
    return { terms, truncated: true };
  },
});

export const addBlockedTerm = action({
  args: { instanceId: v.id("instances"), text: v.string() },
  handler: async (ctx, args): Promise<BlockedTerm> => {
    const validated = validateBlockedTerm(args.text);
    if (!validated.ok) {
      throw new ConvexError(validated.error);
    }
    const auth = await authorizeModeration(ctx, args.instanceId, "blockedTerms");
    const body = (await helix(auth, "add-term", "POST", `${BLOCKED_TERMS_URL}?${moderationParams(auth)}`, {
      text: validated.value,
    })) as HelixBlockedTermsPage;
    const term = body.data?.[0];
    if (!term) {
      throw new ConvexError("Twitch accepted the term but returned nothing");
    }
    return { id: term.id, text: term.text, createdAt: term.created_at ?? null, expiresAt: term.expires_at ?? null };
  },
});

export const removeBlockedTerm = action({
  args: { instanceId: v.id("instances"), termId: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    if (!args.termId) {
      throw new ConvexError("No blocked term to remove");
    }
    const auth = await authorizeModeration(ctx, args.instanceId, "blockedTerms");
    await helix(auth, "remove-term", "DELETE", `${BLOCKED_TERMS_URL}?${moderationParams(auth, { id: args.termId })}`);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Timeouts and bans
// ---------------------------------------------------------------------------

interface ModeratedUser {
  login: string;
  displayName: string;
}

export const timeoutUser = action({
  args: {
    instanceId: v.id("instances"),
    login: v.string(),
    seconds: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ModeratedUser> => {
    const duration = validateTimeoutSeconds(args.seconds);
    if (!duration.ok) {
      throw new ConvexError(duration.error);
    }
    const reason = validateBanReason(args.reason ?? "");
    if (!reason.ok) {
      throw new ConvexError(reason.error);
    }
    const auth = await authorizeModeration(ctx, args.instanceId, "timeout");
    const target = await resolveTarget(auth, args.login);
    await helix(auth, "timeout", "POST", `${BANS_URL}?${moderationParams(auth)}`, {
      data: { user_id: target.twitchUserId, duration: duration.value, reason: reason.value },
    });
    return { login: target.login, displayName: target.displayName };
  },
});

export const banUser = action({
  args: { instanceId: v.id("instances"), login: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args): Promise<ModeratedUser> => {
    const reason = validateBanReason(args.reason ?? "");
    if (!reason.ok) {
      throw new ConvexError(reason.error);
    }
    const auth = await authorizeModeration(ctx, args.instanceId, "ban");
    const target = await resolveTarget(auth, args.login);
    await helix(auth, "ban", "POST", `${BANS_URL}?${moderationParams(auth)}`, {
      data: { user_id: target.twitchUserId, reason: reason.value },
    });
    return { login: target.login, displayName: target.displayName };
  },
});

/** Lifts a ban or an active timeout; Helix treats both the same. */
export const unbanUser = action({
  args: { instanceId: v.id("instances"), login: v.string() },
  handler: async (ctx, args): Promise<ModeratedUser> => {
    const auth = await authorizeModeration(ctx, args.instanceId, "ban");
    const target = await resolveTarget(auth, args.login);
    await helix(auth, "unban", "DELETE", `${BANS_URL}?${moderationParams(auth, { user_id: target.twitchUserId })}`);
    return { login: target.login, displayName: target.displayName };
  },
});

// ---------------------------------------------------------------------------
// Chat lockdown
// ---------------------------------------------------------------------------

/**
 * Current chat modes. Reading needs only the read scope every link already
 * carries, so the switches show the real state even before a reconnect grants
 * permission to flip them.
 */
export const getChatSettings = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<ChatSettings> => {
    const auth = await authorizeTwitch(ctx, args.instanceId, MODERATION_SCOPES.readChatSettings);
    const body = await helix(auth, "read-settings", "GET", `${CHAT_SETTINGS_URL}?${moderationParams(auth)}`);
    const settings = chatSettingsFromHelix(body);
    if (!settings) {
      throw new ConvexError("Twitch returned no chat settings for this channel");
    }
    return settings;
  },
});

export const updateChatSettings = action({
  args: {
    instanceId: v.id("instances"),
    patch: v.object({
      emoteMode: v.optional(v.boolean()),
      subscriberMode: v.optional(v.boolean()),
      followerMode: v.optional(v.boolean()),
      followerModeDuration: v.optional(v.number()),
      slowMode: v.optional(v.boolean()),
      slowModeWaitTime: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args): Promise<ChatSettings> => {
    const body = chatSettingsToHelix(args.patch);
    if (!body.ok) {
      throw new ConvexError(body.error);
    }
    const auth = await authorizeModeration(ctx, args.instanceId, "chatSettings");
    const response = await helix(
      auth,
      "update-settings",
      "PATCH",
      `${CHAT_SETTINGS_URL}?${moderationParams(auth)}`,
      body.value
    );
    const settings = chatSettingsFromHelix(response);
    if (!settings) {
      throw new ConvexError("Twitch changed chat settings but returned none");
    }
    return settings;
  },
});
