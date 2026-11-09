import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";
import {
  companionsReplacedBy,
  isInstallationId,
  isSha256Hex,
  isValidCompanionVersion,
  MAX_COMPANION_VERSION_LENGTH,
  MAX_DEVICE_NAME_LENGTH,
} from "./lib/companionCodes";
import { companionsOf, describeReplacedCompanion, writeCompanionCredential } from "./lib/companionRecords";
import { requireInstanceRole } from "./lib/instanceAccess";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  companionAppLink: { kind: "token bucket", rate: 10, period: 10 * MINUTE, capacity: 5 },
});

const RATE_LIMITED_MESSAGE = "Too many pairing attempts. Try again in a few minutes.";

const replacedCompanion = v.object({
  deviceName: v.string(),
  pairedAt: v.number(),
  lastSeenAt: v.union(v.number(), v.null()),
});

/**
 * Makes the desktop app the instance's companion when an admin signs in to
 * it. The app generates the token and keeps it; the dashboard in the app
 * sends only its hash. Being signed in inside the app on that PC is the
 * approval, so the row is written confirmed and approved by the caller.
 *
 * An instance has at most one companion. When another installation is it,
 * nothing is written unless `replaceOtherComputer` is set: the answer names
 * that computer so the dashboard can ask first, since replacing it unpairs
 * a PC the admin may still use. With the flag, that companion is replaced.
 *
 * Idempotent for the same installation and token hash.
 */
export const linkSignedInApp = mutation({
  args: {
    instanceId: v.id("instances"),
    tokenHash: v.string(),
    installationId: v.string(),
    deviceName: v.string(),
    companionVersion: v.string(),
    replaceOtherComputer: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ kind: v.literal("linked"), instanceId: v.id("instances"), instanceName: v.string() }),
    v.object({ kind: v.literal("otherCompanion"), companion: replacedCompanion })
  ),
  handler: async (ctx, args) => {
    const userId = await requireInstanceRole(ctx, args.instanceId, "admin");
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
    const instance = await ctx.db.get(args.instanceId);
    if (!instance) {
      throw new ConvexError("This engine no longer exists.");
    }
    const { ok } = await rateLimiter.limit(ctx, "companionAppLink", { key: userId });
    if (!ok) {
      throw new ConvexError(RATE_LIMITED_MESSAGE);
    }
    const linked = { kind: "linked" as const, instanceId: instance._id, instanceName: instance.name };

    const rows = await companionsOf(ctx, instance._id);
    const own = rows.find((row) => row.installationId === args.installationId);
    if (own && own.tokenHash === args.tokenHash && own.confirmedAt !== undefined) {
      return linked;
    }
    const [other] = companionsReplacedBy(rows, args.installationId);
    if (other && args.replaceOtherComputer !== true) {
      return { kind: "otherCompanion" as const, companion: await describeReplacedCompanion(ctx, other) };
    }
    const now = Date.now();
    await writeCompanionCredential(ctx, {
      instanceId: instance._id,
      installationId: args.installationId,
      tokenHash: args.tokenHash,
      deviceName,
      companionVersion,
      pairedBy: userId,
      pairedAt: now,
      confirmedAt: now,
    });
    return linked;
  },
});
