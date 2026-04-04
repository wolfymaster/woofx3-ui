import type { UploadIntent } from "./types";

// ---------------------------------------------------------------------------
// AWS Signature V4 helpers (Web Crypto API — available in Convex actions)
// ---------------------------------------------------------------------------

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? key.buffer : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(hash);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** URI-encode each path segment individually (preserves `/` separators). */
function encodePathSegments(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

// ---------------------------------------------------------------------------
// Presigned PUT URL generation
// ---------------------------------------------------------------------------

/**
 * Generate an AWS Sig V4 presigned PUT URL for an R2 object.
 * R2 uses the S3-compatible API with region "auto".
 */
export async function generateR2PresignedPutUrl(params: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  objectKey: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const { accountId, accessKeyId, secretAccessKey, bucketName, objectKey } = params;
  const expiresIn = params.expiresInSeconds ?? 3600;

  const region = "auto"; // R2 always uses "auto"
  const service = "s3";
  const host = `${accountId}.r2.cloudflarestorage.com`;

  const now = new Date();
  const datestamp = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const amzdate = now.toISOString().replace(/[:\-]/g, "").slice(0, 15) + "Z"; // YYYYMMDDTHHmmssZ

  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  // Build canonical query string (must be sorted)
  const queryParams: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzdate],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  queryParams.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQueryString = queryParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  // Canonical request
  const canonicalUri = "/" + encodePathSegments(`${bucketName}/${objectKey}`);
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  // String to sign
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzdate,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  // Derive signing key
  const enc = new TextEncoder();
  const kDate = await hmacSha256(enc.encode(`AWS4${secretAccessKey}`), datestamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");

  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  return `https://${host}/${bucketName}/${objectKey}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

// ---------------------------------------------------------------------------
// Adapter functions
// ---------------------------------------------------------------------------

/** Build a sanitized R2 object key for a file upload. */
export function buildR2ObjectKey(instanceId: string, fileName: string): string {
  const uuid = crypto.randomUUID();
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${instanceId}/${uuid}/${sanitized}`;
}

/**
 * Generate an upload intent for Cloudflare R2.
 * Must be called from an action context (needs Date and crypto.subtle).
 *
 * Env vars required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *                    R2_BUCKET_NAME, R2_PUBLIC_URL
 */
export async function generateR2UploadIntent(
  instanceId: string,
  fileName: string
): Promise<UploadIntent> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME env vars.");
  }

  const fileKey = buildR2ObjectKey(instanceId, fileName);

  const uploadUrl = await generateR2PresignedPutUrl({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    objectKey: fileKey,
  });

  return {
    uploadUrl,
    method: "PUT",
    fileKey,
    provider: "r2",
    requiresResponseKey: false,
  };
}

/**
 * Resolve an R2 file key to its public CDN URL.
 * Requires R2_PUBLIC_URL env var (e.g., "https://assets.yourdomain.com").
 */
export function resolveR2Url(fileKey: string): string | null {
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!publicUrl) return null;
  return `${publicUrl.replace(/\/$/, "")}/${fileKey}`;
}

/**
 * Delete an R2 object via the S3-compatible DELETE API.
 * Must be called from an action context (needs fetch and crypto.subtle).
 */
export async function deleteR2File(fileKey: string): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("R2 env vars not configured for deletion.");
  }

  const region = "auto";
  const service = "s3";
  const host = `${accountId}.r2.cloudflarestorage.com`;

  const now = new Date();
  const datestamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzdate = now.toISOString().replace(/[:\-]/g, "").slice(0, 15) + "Z";

  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const canonicalUri = "/" + encodePathSegments(`${bucketName}/${fileKey}`);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-amz-date:${amzdate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // SHA-256 of empty string

  const canonicalRequest = ["DELETE", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const hashedCanonical = await sha256Hex(canonicalRequest);
  const stringToSign = ["AWS4-HMAC-SHA256", amzdate, credentialScope, hashedCanonical].join("\n");

  const enc = new TextEncoder();
  const kDate = await hmacSha256(enc.encode(`AWS4${secretAccessKey}`), datestamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}/${bucketName}/${fileKey}`, {
    method: "DELETE",
    headers: {
      Authorization: authHeader,
      "x-amz-date": amzdate,
      "x-amz-content-sha256": payloadHash,
    },
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 DELETE failed: ${res.status} ${await res.text()}`);
  }
}
