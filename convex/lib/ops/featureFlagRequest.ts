import { v } from "convex/values";
import {
  FEATURE_FLAG_DESCRIPTION_MAX,
  FEATURE_FLAG_KEY_MAX,
  FEATURE_FLAG_OWNER_MAX,
  type FeatureFlagDefinition,
  featureFlagStateValidator,
  isFeatureFlagKey,
  validateFeatureFlagDefinition,
  validateFeatureFlagRules,
} from "../featureFlags";

/**
 * A flag as the backoffice sends it. Rows are the whole definition, so a
 * create and an update carry the same shape; the key only names the row.
 * Target ids are unchecked strings until the mutation resolves them, and are
 * never enough to write a rule that would silently match nothing.
 */
export interface FeatureFlagRulesInput {
  users?: string[];
  accounts?: string[];
  instances?: string[];
  percent?: number;
  hosting?: "managed" | "external";
  entitlement?: string;
}

export interface FeatureFlagInput extends FeatureFlagDefinition {
  key: string;
  state: "off" | "on" | "rules";
  rules?: FeatureFlagRulesInput;
}

export type FeatureFlagParseResult = { ok: true; value: FeatureFlagInput } | { ok: false; message: string };

/** Target lists an operator may set; each is one row of the rules editor. */
const MAX_TARGETS = 100;
const CONVEX_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const featureFlagRulesInputValidator = v.object({
  users: v.optional(v.array(v.string())),
  accounts: v.optional(v.array(v.string())),
  instances: v.optional(v.array(v.string())),
  percent: v.optional(v.number()),
  hosting: v.optional(v.union(v.literal("managed"), v.literal("external"))),
  entitlement: v.optional(v.string()),
});

export const featureFlagInputValidator = v.object({
  key: v.string(),
  description: v.string(),
  owner: v.string(),
  removeBy: v.string(),
  state: featureFlagStateValidator,
  rules: v.optional(featureFlagRulesInputValidator),
});

export function parseFeatureFlagRequest(body: unknown): FeatureFlagParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const raw = body as Record<string, unknown>;

  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  if (!isFeatureFlagKey(key)) {
    return {
      ok: false,
      message: `key must be 1 to ${FEATURE_FLAG_KEY_MAX} characters: a lowercase word, then dot- or dash-separated words`,
    };
  }
  const definition = {
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    owner: typeof raw.owner === "string" ? raw.owner.trim() : "",
    removeBy: typeof raw.removeBy === "string" ? raw.removeBy.trim() : "",
  };
  if (definition.description.length > FEATURE_FLAG_DESCRIPTION_MAX) {
    return { ok: false, message: `description must be at most ${FEATURE_FLAG_DESCRIPTION_MAX} characters` };
  }
  if (definition.owner.length > FEATURE_FLAG_OWNER_MAX) {
    return { ok: false, message: `owner must be at most ${FEATURE_FLAG_OWNER_MAX} characters` };
  }
  try {
    validateFeatureFlagDefinition(definition);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const state = raw.state;
  if (state !== "off" && state !== "on" && state !== "rules") {
    return { ok: false, message: 'state must be "off", "on" or "rules"' };
  }
  const parsed = parseRules(raw.rules);
  if (typeof parsed === "string") {
    return { ok: false, message: parsed };
  }
  if (state === "rules" && parsed === undefined) {
    return { ok: false, message: 'state "rules" needs at least one rule' };
  }
  if (state !== "rules" && parsed !== undefined) {
    return { ok: false, message: `state "${state}" ignores rules; set state "rules" to target` };
  }
  return { ok: true, value: { key, ...definition, state, ...(parsed === undefined ? {} : { rules: parsed }) } };
}

/** The key alone, for a removal. */
export function parseFeatureFlagKeyRequest(
  body: unknown
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const key = (body as Record<string, unknown>).key;
  if (typeof key !== "string" || !isFeatureFlagKey(key.trim())) {
    return { ok: false, message: "key must name a feature flag" };
  }
  return { ok: true, value: key.trim() };
}

/** The rules, undefined when none were given, or why they cannot be saved. */
function parseRules(raw: unknown): FeatureFlagRulesInput | undefined | string {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) {
    return "rules must be an object";
  }
  const input = raw as Record<string, unknown>;
  const rules: FeatureFlagRulesInput = {};

  for (const field of ["users", "accounts", "instances"] as const) {
    const value = input[field];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value) || value.length > MAX_TARGETS) {
      return `${field} must be a list of at most ${MAX_TARGETS} ids`;
    }
    const ids: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string" || !CONVEX_ID.test(entry.trim())) {
        return `${field} must hold ids`;
      }
      ids.push(entry.trim());
    }
    if (ids.length > 0) {
      rules[field] = ids;
    }
  }

  if (input.percent !== undefined) {
    if (typeof input.percent !== "number") {
      return "percent must be a number";
    }
    rules.percent = input.percent;
  }
  if (input.hosting !== undefined) {
    if (input.hosting !== "managed" && input.hosting !== "external") {
      return 'hosting must be "managed" or "external"';
    }
    rules.hosting = input.hosting;
  }
  if (input.entitlement !== undefined) {
    if (typeof input.entitlement !== "string" || input.entitlement.trim() === "") {
      return "entitlement must name an entitlement feature";
    }
    rules.entitlement = input.entitlement.trim();
  }

  try {
    validateFeatureFlagRules(rules);
  } catch (error) {
    return (error as Error).message;
  }
  return Object.keys(rules).length === 0 ? undefined : rules;
}
