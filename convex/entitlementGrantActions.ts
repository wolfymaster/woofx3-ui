"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { grantPayload, grantSigningInput, isLegacyGrantError } from "./lib/entitlementGrant";
import { entitlementSigningKey, publicKeyEntry, signGrant } from "./lib/entitlementSigning";

interface EntitlementEngineApi extends EngineApi {
  setEntitlementGrant(token: string): Promise<{ seq: number }>;
}

/**
 * Signs the instance's current grant and sends it to its engine. Convex is the
 * only signer; the key never leaves this deployment. A failure is recorded on
 * the grant row and retried by the renewal sweep.
 */
export const push = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const key = entitlementSigningKey();
    if (key === null) {
      return;
    }
    const prepared = await ctx.runMutation(internal.engineEntitlements.prepareGrant, { instanceId });
    if (prepared === null) {
      return;
    }
    const payload = grantPayload({
      engineName: prepared.engineName,
      seq: prepared.seq,
      grants: prepared.grants,
      nowMs: prepared.nowMs,
    });
    const token = signGrant(key, grantSigningInput(key.id, payload));
    let error: string | undefined;
    try {
      await createEngineRpcSession<EntitlementEngineApi>(
        prepared.url,
        prepared.clientId,
        prepared.clientSecret
      ).setEntitlementGrant(token);
    } catch (err) {
      error = isLegacyGrantError(err)
        ? "The engine predates entitlement grants"
        : err instanceof Error
          ? err.message
          : String(err);
    }
    await ctx.runMutation(internal.engineEntitlements.recordGrantPush, { instanceId, seq: prepared.seq, error });
  },
});

/**
 * The `WOOFX3_ENTITLEMENT_PUBLIC_KEYS` entry managed engines need to verify
 * this deployment's grants:
 *
 *   bunx convex run entitlementGrantActions:publicKey
 */
export const publicKey = internalAction({
  args: {},
  handler: async (): Promise<string> => {
    const key = entitlementSigningKey();
    if (key === null) {
      throw new Error("ENTITLEMENT_SIGNING_KEY is not set on this deployment");
    }
    return publicKeyEntry(key);
  },
});
