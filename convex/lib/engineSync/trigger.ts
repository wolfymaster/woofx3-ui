import { v } from "convex/values";

/**
 * What started a sync run. "registration" is the run every handshake starts,
 * so a newly registered engine's catalogs are mirrored before setup and the
 * scene editor read them, rather than at the first scheduled sweep.
 */
export const syncTriggerValidator = v.union(v.literal("scheduled"), v.literal("manual"), v.literal("registration"));
