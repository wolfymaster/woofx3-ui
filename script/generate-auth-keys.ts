// Run with: bun script/generate-auth-keys.ts
// Generates JWT_PRIVATE_KEY and JWKS for @convex-dev/auth

const keyPair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"]
);

const privateKeyDer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
const privateKeyB64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyDer)));
const privateKeyPem = [
  "-----BEGIN PRIVATE KEY-----",
  ...privateKeyB64.match(/.{1,64}/g)!,
  "-----END PRIVATE KEY-----",
].join("\n");

const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
const jwks = JSON.stringify({
  keys: [{ ...publicKeyJwk, use: "sig", alg: "RS256" }],
});

console.log("=== JWT_PRIVATE_KEY ===");
console.log(privateKeyPem);
console.log("\n=== JWKS ===");
console.log(jwks);
console.log("\nSet both as environment variables in your Convex dashboard.");
