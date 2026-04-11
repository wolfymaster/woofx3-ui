import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Ping the woofx3 engine at GET <engineUrl>/ping to verify connectivity.
 * The URL is passed directly from the UI input field.
 * Returns { ok: true } on HTTP 200 or { ok: false, error: string } on failure.
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

    const pingUrl =
      baseUrl.startsWith("http://") || baseUrl.startsWith("https://")
        ? `${new URL(baseUrl).origin}/ping`
        : `http://${baseUrl}/ping`;

    console.log(`[engineHealth] Testing connection to: ${pingUrl}`);

    try {
      const response = await fetch(pingUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        console.log(`[engineHealth] Connection successful`);
        return { ok: true };
      }
      console.log(`[engineHealth] Connection failed: HTTP ${response.status}`);
      return { ok: false, error: `HTTP ${response.status}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[engineHealth] Connection error: ${msg}`);
      return {
        ok: false,
        error: msg,
      };
    }
  },
});
