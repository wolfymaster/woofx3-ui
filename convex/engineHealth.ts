import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { createEngineGatewaySession } from "./lib/engineInstanceUrl";

/**
 * Ping the woofx3 engine via capnweb gateway.ping() to verify connectivity.
 * Returns { ok: true } on success or { ok: false, error: string } on failure.
 */
type TestConnectionResult = { ok: true } | { ok: false; error: string };

export const testConnection = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<TestConnectionResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { ok: false, error: "Not authenticated" };
    }

    const baseUrl = url.trim();
    if (!baseUrl) {
      return { ok: false, error: "No engine URL provided" };
    }

    console.log(`[engineHealth] Testing connection to: ${baseUrl}`);

    try {
      const gateway = createEngineGatewaySession(baseUrl);
      await gateway.ping();
      console.log(`[engineHealth] Connection successful`);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[engineHealth] Connection error: ${msg}`);
      return { ok: false, error: msg };
    }
  },
});
