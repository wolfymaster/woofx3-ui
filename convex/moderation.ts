import { getAuthUserId } from "@convex-dev/auth/server";
import type { TwitchHelixResult } from "@woofx3/api";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, query } from "./_generated/server";
import type { EngineApi } from "./lib/engineInstanceUrl";
import {
  CAPABILITY_RULES,
  type CapabilityStatus,
  type ChatSettings,
  chatSettingsFromHelix,
  chatSettingsToHelix,
  describeModerationError,
  type HelixChatSettingsPatch,
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
import { helixResponse, type TwitchHelixRoute, twitchHelixRoute } from "./lib/twitchEngineHelix";
import { fetchTwitchUser, normalizeTwitchLogin, type TwitchUser } from "./lib/twitchUsers";

// Moderation for the dashboard widget: blocked terms, timeouts and bans, and
// chat lockdown modes. Straight to Helix with the broadcaster's token, the same
// shape as convex/twitchBroadcast.ts, or through an engine that advertises
// twitch.moderation (convex/lib/twitchEngineHelix.ts).
//
// Who may do what is decided by CAPABILITY_RULES in convex/lib/moderation.ts;
// every action enforces it here, and the widget reads the same rules through
// `access` only to disable and explain.
//
// Every failure leaves as a ConvexError carrying the sentence to show: in
// production Convex replaces a plain Error's message with "Server Error", and
// a streamer mid-raid needs "reconnect Twitch", not a request id. Helpers
// shared with other modules (authorizeTwitch, fetchTwitchUser) throw plain
// Errors, so their calls go through `readable`.

const HELIX = "https://api.twitch.tv/helix";
const BLOCKED_TERMS_URL = `${HELIX}/moderation/blocked_terms`;
const BANS_URL = `${HELIX}/moderation/bans`;
const CHAT_SETTINGS_URL = `${HELIX}/chat/settings`;

const BLOCKED_TERMS_PAGE_SIZE = 100;
/** A bound on the pagination loop. A channel past this many terms sees the first 2000. */
const BLOCKED_TERMS_MAX_PAGES = 20;

const ROLE_REFUSALS: Record<ModerationCapability, string> = {
  addBlockedTerm: "You don't have permission to block terms on this instance",
  removeBlockedTerm: "Only the instance's owners and admins can remove blocked terms",
  timeout: "You don't have permission to time out users on this instance",
  ban: "Only the instance's owners and admins can ban or unban",
  chatSettings: "Only the instance's owners and admins can change chat modes",
};

/** Rethrows a plain Error as a ConvexError with the same message, so production keeps it. */
async function readable<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }
    throw new ConvexError(error instanceof Error ? error.message : String(error));
  }
}

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
  return readable(authorizeTwitch(ctx, instanceId, rule.scope));
}

/** Query string with the broadcaster acting as its own moderator, which is who the token belongs to. */
function moderationParams(auth: AuthorizedTwitchCall, extra: Record<string, string> = {}): string {
  return new URLSearchParams({
    broadcaster_id: auth.broadcasterUserId,
    moderator_id: auth.broadcasterUserId,
    ...extra,
  }).toString();
}

/**
 * One moderation call, described for both paths: the Helix request Convex
 * sends itself, and the engine method that sends the same one.
 */
export interface ModerationRequest {
  operation: ModerationOperation;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  viaEngine: (engine: EngineApi) => Promise<TwitchHelixResult>;
}

export const moderationRequests = {
  listTerms: (auth: AuthorizedTwitchCall, cursor: string | undefined): ModerationRequest => ({
    operation: "list-terms",
    method: "GET",
    url: `${BLOCKED_TERMS_URL}?${moderationParams(auth, {
      first: String(BLOCKED_TERMS_PAGE_SIZE),
      ...(cursor ? { after: cursor } : {}),
    })}`,
    viaEngine: (engine) =>
      engine.twitchGetBlockedTerms({ first: BLOCKED_TERMS_PAGE_SIZE, ...(cursor ? { after: cursor } : {}) }),
  }),
  addTerm: (auth: AuthorizedTwitchCall, text: string): ModerationRequest => ({
    operation: "add-term",
    method: "POST",
    url: `${BLOCKED_TERMS_URL}?${moderationParams(auth)}`,
    body: { text },
    viaEngine: (engine) => engine.twitchAddBlockedTerm({ text }),
  }),
  removeTerm: (auth: AuthorizedTwitchCall, termId: string): ModerationRequest => ({
    operation: "remove-term",
    method: "DELETE",
    url: `${BLOCKED_TERMS_URL}?${moderationParams(auth, { id: termId })}`,
    viaEngine: (engine) => engine.twitchRemoveBlockedTerm({ id: termId }),
  }),
  timeout: (auth: AuthorizedTwitchCall, userId: string, duration: number): ModerationRequest => ({
    operation: "timeout",
    method: "POST",
    url: `${BANS_URL}?${moderationParams(auth)}`,
    body: { data: { user_id: userId, duration } },
    viaEngine: (engine) => engine.twitchBanUser({ user_id: userId, duration }),
  }),
  ban: (auth: AuthorizedTwitchCall, userId: string, reason: string): ModerationRequest => ({
    operation: "ban",
    method: "POST",
    url: `${BANS_URL}?${moderationParams(auth)}`,
    body: { data: { user_id: userId, reason } },
    viaEngine: (engine) => engine.twitchBanUser({ user_id: userId, reason }),
  }),
  unban: (auth: AuthorizedTwitchCall, userId: string): ModerationRequest => ({
    operation: "unban",
    method: "DELETE",
    url: `${BANS_URL}?${moderationParams(auth, { user_id: userId })}`,
    viaEngine: (engine) => engine.twitchUnbanUser({ user_id: userId }),
  }),
  readSettings: (auth: AuthorizedTwitchCall): ModerationRequest => ({
    operation: "read-settings",
    method: "GET",
    url: `${CHAT_SETTINGS_URL}?${moderationParams(auth)}`,
    viaEngine: (engine) => engine.twitchGetChatSettings(),
  }),
  updateSettings: (auth: AuthorizedTwitchCall, patch: HelixChatSettingsPatch): ModerationRequest => ({
    operation: "update-settings",
    method: "PATCH",
    url: `${CHAT_SETTINGS_URL}?${moderationParams(auth)}`,
    body: patch,
    viaEngine: (engine) => engine.twitchUpdateChatSettings(patch),
  }),
};

const READ_OPERATIONS: ReadonlySet<ModerationOperation> = new Set(["list-terms", "read-settings"]);

export async function helix(
  auth: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  request: ModerationRequest
): Promise<unknown> {
  const { operation, method, url, body } = request;
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.accessToken}`, "Client-Id": auth.clientId };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await readable(
    helixResponse(route, {
      operation,
      kind: READ_OPERATIONS.has(operation) ? "read" : "write",
      viaEngine: request.viaEngine,
      direct: () =>
        fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
    })
  );
  if (!response.ok) {
    const text = await response.text();
    throw new ConvexError(describeModerationError(operation, response.status, helixErrorMessage(text)));
  }
  if (response.status === 204) {
    return null;
  }
  return readable(response.json());
}

export async function resolveTarget(
  auth: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  input: string
): Promise<TwitchUser> {
  const login = normalizeTwitchLogin(input);
  if (!login) {
    throw new ConvexError(`"${input.trim()}" is not a Twitch username`);
  }
  const user = await readable(fetchTwitchUser(auth, { login }, route));
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
    // Anyone who may add a term may see the list they are adding to.
    const auth = await authorizeModeration(ctx, args.instanceId, "addBlockedTerm");
    const route = await twitchHelixRoute(ctx, args.instanceId, "twitch.moderation");

    const terms: BlockedTerm[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < BLOCKED_TERMS_MAX_PAGES; page++) {
      const body = (await helix(auth, route, moderationRequests.listTerms(auth, cursor))) as HelixBlockedTermsPage;
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
    const auth = await authorizeModeration(ctx, args.instanceId, "addBlockedTerm");
    const route = await twitchHelixRoute(ctx, args.instanceId, "twitch.moderation");
    const body = (await helix(auth, route, moderationRequests.addTerm(auth, validated.value))) as HelixBlockedTermsPage;
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
    const auth = await authorizeModeration(ctx, args.instanceId, "removeBlockedTerm");
    const route = await twitchHelixRoute(ctx, args.instanceId, "twitch.moderation");
    await helix(auth, route, moderationRequests.removeTerm(auth, args.termId));
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
  },
  handler: async (ctx, args): Promise<ModeratedUser> => {
    const duration = validateTimeoutSeconds(args.seconds);
    if (!duration.ok) {
      throw new ConvexError(duration.error);
    }
    const auth = await authorizeModeration(ctx, args.instanceId, "timeout");
    const route = await twitchHelixRoute(ctx, args.instanceId, "twitch.moderation");
    const target = await resolveTarget(auth, route, args.login);
    await helix(auth, route, moderationRequests.timeout(auth, target.twitchUserId, duration.value));
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
    const route = await twitchHelixRoute(ctx, args.instanceId, "twitch.moderation");
    const target = await resolveTarget(auth, route, args.login);
    await helix(auth, route, moderationRequests.ban(auth, target.twitchUserId, reason.value));
    return { login: target.login, displayName: target.displayName };
  },
});

/** Lifts a ban or an active timeout; Helix treats both the same. */
export const unbanUser = action({
  args: { instanceId: v.id("instances"), login: v.string() },
  handler: async (ctx, args): Promise<ModeratedUser> => {
    const auth = await authorizeModeration(ctx, args.instanceId, "ban");
    const route = await twitchHelixRoute(ctx, args.instanceId, "twitch.moderation");
    const target = await resolveTarget(auth, route, args.login);
    await helix(auth, route, moderationRequests.unban(auth, target.twitchUserId));
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
    const auth = await readable(authorizeTwitch(ctx, args.instanceId, MODERATION_SCOPES.readChatSettings));
    const route = await twitchHelixRoute(ctx, args.instanceId, "twitch.moderation");
    const body = await helix(auth, route, moderationRequests.readSettings(auth));
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
    const route = await twitchHelixRoute(ctx, args.instanceId, "twitch.moderation");
    const response = await helix(auth, route, moderationRequests.updateSettings(auth, body.value));
    const settings = chatSettingsFromHelix(response);
    if (!settings) {
      throw new ConvexError("Twitch changed chat settings but returned none");
    }
    return settings;
  },
});
