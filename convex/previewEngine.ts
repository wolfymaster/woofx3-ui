import { v } from "convex/values";
import { query } from "./_generated/server";
import { previewEngine } from "./lib/previewEngine";

/**
 * The engine this pull request preview is paired with, so onboarding can offer it. Null on
 * production and on previews that name no engine. The URL is public anyway; the registration
 * token is never returned.
 */
export const get = query({
  args: {},
  returns: v.union(v.null(), v.object({ url: v.string(), version: v.union(v.string(), v.null()) })),
  handler: async () => previewEngine(),
});
