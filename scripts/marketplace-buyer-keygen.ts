/**
 * Generates a key pair for marketplace buyer tokens and prints where each half goes.
 *
 *   bun scripts/marketplace-buyer-keygen.ts <kid>
 *
 * The kid names the key on both sides; a dated one (`cp-2026-10`) makes
 * rotation readable. Rotate by adding the new public key to the marketplace's
 * list beside the old one, then switching Convex to the new private key, then
 * dropping the old public key once tokens signed with it have expired.
 *
 * Configure the marketplace first: until it lists the public key, every token
 * Convex mints with the private key is refused.
 */

import { generateBuyerSigningKey } from "../convex/lib/marketplaceBuyerToken";

const kid = process.argv[2];
if (!kid) {
  console.error("usage: bun scripts/marketplace-buyer-keygen.ts <kid>");
  process.exit(2);
}

const { signingKeyJwk, controlPlanePublicKey } = await generateBuyerSigningKey(kid);

console.log("# 1. woofx3-marketplace-api env (append with a comma to rotate):");
console.log(`CONTROL_PLANE_PUBLIC_KEYS=${controlPlanePublicKey}`);
console.log("");
console.log("# 2. Convex env, once the marketplace has the public key (the private key is a secret):");
console.log(`bunx convex env set MARKETPLACE_BUYER_SIGNING_KEY_ID '${kid}'`);
console.log(`bunx convex env set MARKETPLACE_BUYER_SIGNING_KEY '${signingKeyJwk}'`);
