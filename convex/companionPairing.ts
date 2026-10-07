import { getAuthUserId } from "@convex-dev/auth/server";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, type QueryCtx, query } from "./_generated/server";
import {
  companionsReplacedBy,
  formatUserCode,
  generateUserCode,
  isInstallationId,
  isSha256Hex,
  isValidCompanionVersion,
  MAX_COMPANION_ROWS_PER_INSTANCE,
  MAX_COMPANION_VERSION_LENGTH,
  MAX_DEVICE_NAME_LENGTH,
  normalizeUserCode,
  PAIRING_TTL_MS,
} from "./lib/companionCodes";
import { deleteCompanion, deleteCompanionPresence } from "./lib/companionRecords";
import { requireInstanceRole } from "./lib/instanceAccess";
import { roleSatisfies } from "./lib/instanceRoles";
import { generateOpaqueToken, hashOpaqueToken, isOpaqueToken } from "./lib/oauthHandoff";
import { getInstanceMembership } from "./lib/teamAccess";

/**
 * Pairing a companion app with an instance, in the shape of the OAuth device
 * authorization grant (RFC 8628):
 *
 *   companion: generates its token ──▶ start(tokenHash) ──▶ shows userCode,
 *              opens /companion/pair?code=…
 *   browser:   signed-in admin approves for an instance ──▶ the companions
 *              row is written with that tokenHash, in the same transaction
 *   companion: companions:self(token) turns non-null ──▶ the person at the PC
 *              confirms who approved it, or rejects it
 *
 * The companion makes its own token and sends only the hash, so no secret
 * ever travels back to it and nothing is lost if a response goes missing.
 * The device code (what the companion holds to watch this pairing) is drawn
 * here, in an action, because query and mutation randomness is seeded for
 * determinism; only its hash is stored.
 *
 * A pairing expires PAIRING_TTL_MS after it starts. Expiry is read from
 * `expiresAt` rather than stored as a status, so no scheduled job races an
 * approval. Mutations enforce it against the clock. Queries never read the
 * clock, because a query does not re-run as time passes: they return
 * `expiresAt`, and the companion and the approval page judge expiry
 * themselves.
 *
 * The user code is a short-lived capability: whoever holds it may see the
 * device details and decline the pairing, so those need only a sign-in.
 * Approving binds a device that will act on the instance, which is an admin
 * concern, so it needs the admin role on the chosen instance.
 */

const CODE_ALLOCATION_ATTEMPTS = 3;

/** Rows past expiry are kept this long, so a late read answers with the row rather than "unknown". */
const EXPIRED_ROW_RETENTION_MS = 60 * 60_000;

const CLEANUP_BATCH_SIZE = 500;

// `start` is public and unauthenticated. The per-installation limit keeps one
// well-behaved machine in check, but the caller chooses its own
// `installationId`, so a determined caller can mint new ones: the global
// bucket is the real ceiling, and it is set high enough that ordinary use
// cannot exhaust it. `start` checks the per-installation bucket first so
// calls it refuses do not spend global capacity.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  companionPairingStart: { kind: "token bucket", rate: 3000, period: HOUR, capacity: 300 },
  companionPairingStartPerInstallation: { kind: "token bucket", rate: 10, period: 10 * MINUTE, capacity: 5 },
  companionPairingDeny: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },
});

const RATE_LIMITED_MESSAGE = "Too many pairing attempts. Try again in a few minutes.";

const pairingStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("cancelled"),
  v.literal("unknown")
);

/** Whether a pending pairing has run out of time. Mutations only. */
function isExpired(row: Doc<"companionPairings">, now: number): boolean {
  return row.status === "pending" && now > row.expiresAt;
}

async function latestByUserCode(ctx: QueryCtx, userCode: string) {
  return ctx.db
    .query("companionPairings")
    .withIndex("by_user_code", (q) => q.eq("userCode", userCode))
    .order("desc")
    .first();
}

// ── Companion side ─────────────────────────────────────────────────────────

type PairingStart = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  expiresInMs: number;
};

/**
 * `expiresInMs` is what the companion waits by: a duration, so a skewed clock
 * on the PC cannot cut the wait short or stretch it.
 */
export const start = action({
  args: {
    deviceName: v.string(),
    companionVersion: v.string(),
    installationId: v.string(),
    tokenHash: v.string(),
  },
  returns: v.object({
    deviceCode: v.string(),
    userCode: v.string(),
    verificationUrl: v.string(),
    expiresAt: v.number(),
    expiresInMs: v.number(),
  }),
  handler: async (ctx, args): Promise<PairingStart> => {
    const deviceName = args.deviceName.trim();
    const companionVersion = args.companionVersion.trim();
    if (deviceName.length === 0 || deviceName.length > MAX_DEVICE_NAME_LENGTH) {
      throw new ConvexError(`deviceName must be 1-${MAX_DEVICE_NAME_LENGTH} characters`);
    }
    if (!isValidCompanionVersion(companionVersion)) {
      throw new ConvexError(`companionVersion must be 1-${MAX_COMPANION_VERSION_LENGTH} characters`);
    }
    if (!isInstallationId(args.installationId)) {
      throw new ConvexError("installationId must be a lowercase UUID");
    }
    if (!isSha256Hex(args.tokenHash)) {
      throw new ConvexError("tokenHash must be a lowercase SHA-256 hex digest");
    }
    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) {
      throw new Error("SITE_URL env var is not set");
    }
    const perInstallation = await rateLimiter.limit(ctx, "companionPairingStartPerInstallation", {
      key: args.installationId,
    });
    if (!perInstallation.ok) {
      throw new ConvexError(RATE_LIMITED_MESSAGE);
    }
    const global = await rateLimiter.limit(ctx, "companionPairingStart");
    if (!global.ok) {
      throw new ConvexError(RATE_LIMITED_MESSAGE);
    }

    const deviceCode = generateOpaqueToken();
    const deviceCodeHash = await hashOpaqueToken(deviceCode);
    for (let attempt = 0; attempt < CODE_ALLOCATION_ATTEMPTS; attempt++) {
      const userCode = generateUserCode((bytes) => {
        crypto.getRandomValues(bytes);
      });
      const inserted: { expiresAt: number } | null = await ctx.runMutation(internal.companionPairing.insertPairing, {
        deviceCodeHash,
        tokenHash: args.tokenHash,
        installationId: args.installationId,
        userCode,
        deviceName,
        companionVersion,
      });
      if (inserted) {
        const display = formatUserCode(userCode);
        return {
          deviceCode,
          userCode: display,
          verificationUrl: `${siteUrl}/companion/pair?code=${display}`,
          expiresAt: inserted.expiresAt,
          expiresInMs: PAIRING_TTL_MS,
        };
      }
    }
    throw new ConvexError("Could not allocate a pairing code");
  },
});

/** Null when the user code is held by a pairing that has not expired; the caller draws another. */
export const insertPairing = internalMutation({
  args: {
    deviceCodeHash: v.string(),
    tokenHash: v.string(),
    installationId: v.string(),
    userCode: v.string(),
    deviceName: v.string(),
    companionVersion: v.string(),
  },
  returns: v.union(v.null(), v.object({ expiresAt: v.number() })),
  handler: async (ctx, args) => {
    const now = Date.now();
    const holder = await latestByUserCode(ctx, args.userCode);
    if (holder && holder.expiresAt >= now) {
      return null;
    }
    const expiresAt = now + PAIRING_TTL_MS;
    await ctx.db.insert("companionPairings", { ...args, status: "pending", createdAt: now, expiresAt });
    return { expiresAt };
  },
});

/**
 * The companion watches this for a decline while it waits; an approval it
 * sees through `companions:self`. A pending row stays "pending" here after it
 * expires: the companion stops waiting on its own timer.
 */
export const status = query({
  args: { deviceCode: v.string() },
  returns: v.object({ status: pairingStatus, expiresAt: v.optional(v.number()) }),
  handler: async (ctx, { deviceCode }) => {
    if (!isOpaqueToken(deviceCode)) {
      return { status: "unknown" as const };
    }
    const deviceCodeHash = await hashOpaqueToken(deviceCode);
    const row = await ctx.db
      .query("companionPairings")
      .withIndex("by_device_code_hash", (q) => q.eq("deviceCodeHash", deviceCodeHash))
      .first();
    if (!row) {
      return { status: "unknown" as const };
    }
    return { status: row.status, expiresAt: row.expiresAt };
  },
});

/**
 * The companion gave up on this pairing: the person cancelled, its timer ran
 * out, or it lost the token. A pending pairing can then no longer be
 * approved, so no companion row is written for a token nobody holds. The
 * device code is the capability, so no sign-in is needed. Idempotent: a
 * pairing that is not pending, or does not exist, is left as it is.
 */
export const cancel = mutation({
  args: { deviceCode: v.string() },
  returns: v.null(),
  handler: async (ctx, { deviceCode }) => {
    if (!isOpaqueToken(deviceCode)) {
      return null;
    }
    const deviceCodeHash = await hashOpaqueToken(deviceCode);
    const row = await ctx.db
      .query("companionPairings")
      .withIndex("by_device_code_hash", (q) => q.eq("deviceCodeHash", deviceCodeHash))
      .first();
    if (row && row.status === "pending") {
      await ctx.db.patch(row._id, { status: "cancelled" });
    }
    return null;
  },
});

// ── Browser side ───────────────────────────────────────────────────────────

/**
 * What the approval page shows. Null when signed out or the code is
 * malformed. Device details come only with a pending row. The page does not
 * judge expiry from `expiresAt` against the browser's clock, which may be
 * skewed: it asks `timeLeft` once and counts down from there.
 */
export const getForApproval = query({
  args: { userCode: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: pairingStatus,
      deviceName: v.optional(v.string()),
      companionVersion: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      expiresAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    if (!(await getAuthUserId(ctx))) {
      return null;
    }
    const userCode = normalizeUserCode(args.userCode);
    if (!userCode) {
      return null;
    }
    const row = await latestByUserCode(ctx, userCode);
    if (!row) {
      return { status: "unknown" as const };
    }
    if (row.status !== "pending") {
      return { status: row.status, expiresAt: row.expiresAt };
    }
    return {
      status: row.status,
      deviceName: row.deviceName,
      companionVersion: row.companionVersion,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  },
});

/**
 * How long a pending pairing has left, by the server's clock, or null when
 * the code is not pending. An action rather than a query because it reads
 * the clock; the approval page calls it once when a code loads and counts
 * down from the answer with its own monotonic timer, so a skewed browser
 * clock does not show a live code as expired or the reverse. Approving and
 * declining still check expiry on the server.
 */
export const timeLeft = action({
  args: { userCode: v.string() },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, args): Promise<number | null> => {
    if (!(await getAuthUserId(ctx))) {
      return null;
    }
    const userCode = normalizeUserCode(args.userCode);
    if (!userCode) {
      return null;
    }
    const expiresAt: number | null = await ctx.runQuery(internal.companionPairing.pendingExpiresAt, { userCode });
    if (expiresAt === null) {
      return null;
    }
    return Math.max(0, expiresAt - Date.now());
  },
});

export const pendingExpiresAt = internalQuery({
  args: { userCode: v.string() },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, { userCode }) => {
    const row = await latestByUserCode(ctx, userCode);
    if (!row || row.status !== "pending") {
      return null;
    }
    return row.expiresAt;
  },
});

/** Instances the caller may pair a companion with: those where they are admin or owner. */
export const approvableInstances = query({
  args: {},
  returns: v.array(v.object({ instanceId: v.id("instances"), name: v.string() })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const memberships = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
    const result: { instanceId: Id<"instances">; name: string }[] = [];
    for (const membership of memberships) {
      if (!roleSatisfies(membership.role, "admin")) {
        continue;
      }
      const instance = await ctx.db.get(membership.instanceId);
      if (instance) {
        result.push({ instanceId: instance._id, name: instance.name });
      }
    }
    return result;
  },
});

const INVALID_CODE_MESSAGE = "Invalid pairing code";
const UNUSABLE_CODE_MESSAGE = "This pairing code has expired or was already used";

type PendingLookup =
  | { ok: true; row: Doc<"companionPairings"> }
  | { ok: false; reason: "invalid_code" | "not_pending"; message: string };

async function findPendingByUserCode(ctx: QueryCtx, rawUserCode: string, now: number): Promise<PendingLookup> {
  const userCode = normalizeUserCode(rawUserCode);
  if (!userCode) {
    return { ok: false, reason: "invalid_code", message: INVALID_CODE_MESSAGE };
  }
  const row = await latestByUserCode(ctx, userCode);
  if (!row || row.status !== "pending" || isExpired(row, now)) {
    return { ok: false, reason: "not_pending", message: UNUSABLE_CODE_MESSAGE };
  }
  return { ok: true, row };
}

/** The instance's companion rows; at most one is expected, see MAX_COMPANION_ROWS_PER_INSTANCE. */
async function companionsOf(ctx: QueryCtx, instanceId: Id<"instances">) {
  return ctx.db
    .query("companions")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(MAX_COMPANION_ROWS_PER_INSTANCE);
}

/**
 * The companion an approval of this code for this instance would replace, for
 * the approval page's warning. An instance has at most one companion, so
 * approving a different installation removes the current one. Null when
 * nothing would be replaced (no companion, or the same installation pairing
 * again), when the code is not pending, or when the caller is not an admin of
 * the instance. It takes the user code rather than returning the pairing's
 * installation id, so installation ids never reach the browser; no token data
 * is returned either.
 */
export const replacementForApproval = query({
  args: { userCode: v.string(), instanceId: v.id("instances") },
  returns: v.union(
    v.null(),
    v.object({ deviceName: v.string(), pairedAt: v.number(), lastSeenAt: v.union(v.number(), v.null()) })
  ),
  handler: async (ctx, { userCode: rawUserCode, instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!roleSatisfies(membership?.role, "admin")) {
      return null;
    }
    const userCode = normalizeUserCode(rawUserCode);
    if (!userCode) {
      return null;
    }
    const pairing = await latestByUserCode(ctx, userCode);
    if (!pairing || pairing.status !== "pending") {
      return null;
    }
    const [replaced] = companionsReplacedBy(await companionsOf(ctx, instanceId), pairing.installationId);
    if (!replaced) {
      return null;
    }
    const presence = await ctx.db
      .query("companionPresence")
      .withIndex("by_companion", (q) => q.eq("companionId", replaced._id))
      .first();
    return {
      deviceName: replaced.deviceName,
      pairedAt: replaced.pairedAt,
      lastSeenAt: presence?.lastSeenAt ?? null,
    };
  },
});

/**
 * Writes the companion's credential and closes the pairing in one
 * transaction. An instance has at most one companion: a companion from
 * another installation is deleted here, and its `companions:self`
 * subscription turning null unpairs it. The same installation pairing again
 * keeps its companion id and gets the new token.
 */
export const approve = mutation({
  args: { userCode: v.string(), instanceId: v.id("instances") },
  returns: v.null(),
  handler: async (ctx, { userCode, instanceId }) => {
    const userId = await requireInstanceRole(ctx, instanceId, "admin");
    const now = Date.now();
    const pending = await findPendingByUserCode(ctx, userCode, now);
    if (!pending.ok) {
      throw new ConvexError(pending.message);
    }
    const row = pending.row;

    const tokenHolder = await ctx.db
      .query("companions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", row.tokenHash))
      .first();
    const existing = await ctx.db
      .query("companions")
      .withIndex("by_instance_installation", (q) =>
        q.eq("instanceId", instanceId).eq("installationId", row.installationId)
      )
      .first();
    if (tokenHolder && tokenHolder._id !== existing?._id) {
      throw new ConvexError("This companion's token is already in use. Start pairing again from the companion.");
    }
    for (const replaced of companionsReplacedBy(await companionsOf(ctx, instanceId), row.installationId)) {
      await deleteCompanion(ctx, replaced._id);
    }

    const credential = {
      tokenHash: row.tokenHash,
      deviceName: row.deviceName,
      companionVersion: row.companionVersion,
      pairedBy: userId,
      pairedAt: now,
    };
    if (existing) {
      // A new token is unconfirmed until the person at the PC confirms it.
      await ctx.db.patch(existing._id, { ...credential, confirmedAt: undefined });
      await deleteCompanionPresence(ctx, existing._id);
    } else {
      await ctx.db.insert("companions", { instanceId, installationId: row.installationId, ...credential });
    }
    await ctx.db.patch(row._id, { status: "approved", instanceId, approvedBy: userId });
    return null;
  },
});

/**
 * Declines a pending pairing. A wrong or used-up code is answered with a
 * result rather than thrown: a throw would roll back the rate limiter, so
 * only successful declines would count against it and guessing codes here
 * would be free.
 */
export const deny = mutation({
  args: { userCode: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({
      ok: v.literal(false),
      reason: v.union(v.literal("rate_limited"), v.literal("invalid_code"), v.literal("not_pending")),
      message: v.string(),
    })
  ),
  handler: async (ctx, { userCode }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Not authenticated");
    }
    const { ok } = await rateLimiter.limit(ctx, "companionPairingDeny", { key: userId });
    if (!ok) {
      return { ok: false as const, reason: "rate_limited" as const, message: RATE_LIMITED_MESSAGE };
    }
    const pending = await findPendingByUserCode(ctx, userCode, Date.now());
    if (!pending.ok) {
      return { ok: false as const, reason: pending.reason, message: pending.message };
    }
    await ctx.db.patch(pending.row._id, { status: "denied" });
    return { ok: true as const };
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - EXPIRED_ROW_RETENTION_MS;
    const stale = await ctx.db
      .query("companionPairings")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", cutoff))
      .take(CLEANUP_BATCH_SIZE);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    // `start` is public, so a burst of pairings can outrun one batch an hour.
    if (stale.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.companionPairing.cleanupExpired, {});
    }
    return null;
  },
});
