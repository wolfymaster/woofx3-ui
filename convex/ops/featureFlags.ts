import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { ENTITLEMENT_FEATURES } from "../lib/entitlements";
import type { FeatureFlagRules } from "../lib/featureFlags";
import { recordOpsAudit } from "../lib/ops/audit";
import { type FeatureFlagCatalogDto, type FeatureFlagDto, featureFlagDto } from "../lib/ops/dto";
import { type FeatureFlagRulesInput, featureFlagInputValidator } from "../lib/ops/featureFlagInput";

/**
 * Feature flags as operators manage them: every flag with its targeting, and
 * the writes that create, retarget and delete one. The rows are the whole
 * definition, so code reads a flag by the key operators made.
 *
 * Rows are written only here, through the ops API, and every write is audited
 * in the same mutation as the change. A flag rule that names a user, account
 * or engine is checked against the row it names, so an operator's typo fails
 * loudly instead of admitting nobody.
 */

export type FeatureFlagWriteResult<T> =
  | { ok: true; result: T }
  | { ok: false; status: 400 | 404 | 409; code: string; message: string };

type Action = "featureFlags.create" | "featureFlags.update" | "featureFlags.remove";

/** Who asked for the change, and why: recorded with every write, refused ones included. */
interface Writer {
  caller: string;
  actor: string;
  reason: string;
}

const PAGE = 500;

export const list = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }): Promise<FeatureFlagCatalogDto> => {
    const rows = await ctx.db.query("featureFlags").take(PAGE);
    return {
      flags: rows.map((row) => featureFlagDto(row, today)).sort((a, b) => a.key.localeCompare(b.key)),
      entitlements: Object.entries(ENTITLEMENT_FEATURES).map(([key, definition]) => ({
        key,
        description: definition.description,
      })),
    };
  },
});

export const create = internalMutation({
  args: { flag: featureFlagInputValidator, caller: v.string(), actor: v.string(), reason: v.string() },
  handler: async (ctx, { flag, caller, actor, reason }): Promise<FeatureFlagWriteResult<FeatureFlagDto>> => {
    const writer: Writer = { caller, actor, reason };
    const request = { state: flag.state, rules: flag.rules ?? null };
    if ((await byKey(ctx, flag.key)) !== null) {
      return refuse(ctx, writer, "featureFlags.create", flag.key, request, {
        status: 409,
        code: "already_exists",
        message: `A flag "${flag.key}" already exists`,
      });
    }
    const rules = await resolvedRules(ctx, flag.rules);
    if (!rules.ok) {
      return refuse(ctx, writer, "featureFlags.create", flag.key, request, {
        status: 400,
        code: "unknown_target",
        message: rules.message,
      });
    }
    const id = await ctx.db.insert("featureFlags", {
      key: flag.key,
      description: flag.description,
      owner: flag.owner,
      removeBy: flag.removeBy,
      state: flag.state,
      ...(rules.rules === undefined ? {} : { rules: rules.rules }),
      updatedAt: Date.now(),
      updatedBy: actor,
    });
    const row = await ctx.db.get(id);
    if (row === null) {
      throw new Error("A flag inserted in this transaction is missing");
    }
    await audit(ctx, { ...writer, action: "featureFlags.create", key: flag.key, request, result: "ok" });
    return { ok: true, result: featureFlagDto(row, today()) };
  },
});

export const update = internalMutation({
  args: { flag: featureFlagInputValidator, caller: v.string(), actor: v.string(), reason: v.string() },
  handler: async (ctx, { flag, caller, actor, reason }): Promise<FeatureFlagWriteResult<FeatureFlagDto>> => {
    const writer: Writer = { caller, actor, reason };
    const request = { state: flag.state, rules: flag.rules ?? null };
    const existing = await byKey(ctx, flag.key);
    if (existing === null) {
      return refuse(ctx, writer, "featureFlags.update", flag.key, request, {
        status: 404,
        code: "not_found",
        message: `No flag "${flag.key}"`,
      });
    }
    const rules = await resolvedRules(ctx, flag.rules);
    if (!rules.ok) {
      return refuse(ctx, writer, "featureFlags.update", flag.key, request, {
        status: 400,
        code: "unknown_target",
        message: rules.message,
      });
    }
    await ctx.db.patch(existing._id, {
      description: flag.description,
      owner: flag.owner,
      removeBy: flag.removeBy,
      state: flag.state,
      rules: rules.rules,
      updatedAt: Date.now(),
      updatedBy: actor,
    });
    const row = await ctx.db.get(existing._id);
    if (row === null) {
      throw new Error("A flag patched in this transaction is missing");
    }
    await audit(ctx, {
      ...writer,
      action: "featureFlags.update",
      key: flag.key,
      request: {
        from: { state: existing.state, rules: existing.rules ?? null },
        to: { state: flag.state, rules: flag.rules ?? null },
      },
      result: "ok",
    });
    return { ok: true, result: featureFlagDto(row, today()) };
  },
});

export const remove = internalMutation({
  args: { key: v.string(), caller: v.string(), actor: v.string(), reason: v.string() },
  handler: async (ctx, { key, caller, actor, reason }): Promise<FeatureFlagWriteResult<{ key: string }>> => {
    const writer: Writer = { caller, actor, reason };
    const existing = await byKey(ctx, key);
    if (existing === null) {
      return refuse(
        ctx,
        writer,
        "featureFlags.remove",
        key,
        {},
        {
          status: 404,
          code: "not_found",
          message: `No flag "${key}"`,
        }
      );
    }
    await ctx.db.delete(existing._id);
    await audit(ctx, {
      ...writer,
      action: "featureFlags.remove",
      key,
      request: { state: existing.state, rules: existing.rules ?? null },
      result: "ok",
    });
    return { ok: true, result: { key } };
  },
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function byKey(ctx: MutationCtx, key: string): Promise<Doc<"featureFlags"> | null> {
  return ctx.db
    .query("featureFlags")
    .withIndex("by_key", (index) => index.eq("key", key))
    .unique();
}

/** Records the refused attempt and answers with it, so an audit row exists for what did not happen too. */
async function refuse<T>(
  ctx: MutationCtx,
  writer: Writer,
  action: Action,
  key: string,
  request: Record<string, unknown>,
  refusal: { status: 400 | 404 | 409; code: string; message: string }
): Promise<FeatureFlagWriteResult<T>> {
  await audit(ctx, { ...writer, action, key, request, result: refusal.code });
  return { ok: false, ...refusal };
}

function audit(
  ctx: MutationCtx,
  entry: Writer & { action: Action; key: string; request: Record<string, unknown>; result: string }
): Promise<void> {
  return recordOpsAudit(ctx, {
    caller: entry.caller,
    actor: entry.actor,
    action: entry.action,
    target: entry.key,
    reason: entry.reason,
    request: entry.request,
    result: entry.result,
  });
}

/** The stored rules, or why a target id names nothing. */
async function resolvedRules(
  ctx: MutationCtx,
  input: FeatureFlagRulesInput | undefined
): Promise<{ ok: true; rules: FeatureFlagRules | undefined } | { ok: false; message: string }> {
  if (input === undefined) {
    return { ok: true, rules: undefined };
  }
  const users = await targets(ctx, "users", input.users ?? []);
  if (!users.ok) {
    return users;
  }
  const accounts = await targets(ctx, "accounts", input.accounts ?? []);
  if (!accounts.ok) {
    return accounts;
  }
  const instances = await targets(ctx, "instances", input.instances ?? []);
  if (!instances.ok) {
    return instances;
  }
  const rules: FeatureFlagRules = {};
  if (users.ids.length > 0) {
    rules.users = users.ids;
  }
  if (accounts.ids.length > 0) {
    rules.accounts = accounts.ids;
  }
  if (instances.ids.length > 0) {
    rules.instances = instances.ids;
  }
  if (input.percent !== undefined) {
    rules.percent = input.percent;
  }
  if (input.hosting !== undefined) {
    rules.hosting = input.hosting;
  }
  if (input.entitlement !== undefined) {
    rules.entitlement = input.entitlement;
  }
  return { ok: true, rules };
}

async function targets<T extends "users" | "accounts" | "instances">(
  ctx: MutationCtx,
  table: T,
  ids: readonly string[]
): Promise<{ ok: true; ids: Id<T>[] } | { ok: false; message: string }> {
  const seen = new Set<string>();
  const resolved: Id<T>[] = [];
  for (const raw of ids) {
    const id: Id<T> | null = ctx.db.normalizeId(table, raw);
    if (id === null || (await ctx.db.get(id)) === null) {
      return { ok: false, message: `No ${table.slice(0, -1)} with id "${raw}"` };
    }
    if (!seen.has(id)) {
      seen.add(id);
      resolved.push(id);
    }
  }
  return { ok: true, ids: resolved };
}
