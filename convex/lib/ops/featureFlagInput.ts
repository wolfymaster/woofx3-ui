import { v } from "convex/values";
import { featureFlagStateValidator } from "../featureFlags";

/**
 * A flag as the mutations take it, once the contract's request schema has
 * validated it. Target ids are unchecked strings until the mutation resolves
 * them, and are never enough to write a rule that would silently match nothing.
 */
export interface FeatureFlagRulesInput {
  users?: string[];
  accounts?: string[];
  instances?: string[];
  percent?: number;
  hosting?: "managed" | "external";
  entitlement?: string;
}

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
