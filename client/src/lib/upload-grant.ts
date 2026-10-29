import type { UploadGrant } from "@/engine/types";

/**
 * A PUT that never reached storage throws a bare TypeError: a refused CORS
 * preflight is indistinguishable from an unreachable host to the page that
 * made the request, by design. Storage on a bucket the operator has not given
 * a CORS policy fails exactly this way, so the message names that first.
 */
export const UNREACHABLE_STORAGE =
  "the browser could not reach storage. If assets are stored on S3 or R2, that bucket needs a CORS policy allowing PUT from this site — or set the engine's storage.uploadMode to relay.";

/** Why a PUT to an upload grant failed, in words for the person uploading. */
export class UploadPutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UploadPutError";
  }
}

/**
 * Sends `body` to storage with exactly the grant's method and headers. The
 * grant is provider-agnostic (an S3 presigned URL or the engine's own
 * token-guarded endpoint), so nothing here branches on the backend. Throws an
 * `UploadPutError` when the bytes did not land.
 */
export async function putToGrant(grant: UploadGrant, body: Blob): Promise<void> {
  const headers = new Headers();
  for (const header of grant.headers) {
    // The grant is bound to the body's exact length, but browsers forbid page
    // code from setting Content-Length: fetch sends it from the body, which
    // is the size the grant was issued for.
    if (header.name.toLowerCase() === "content-length") {
      continue;
    }
    headers.set(header.name, header.value);
  }
  let response: Response;
  try {
    response = await fetch(grant.uploadUrl, { method: grant.method, headers, body });
  } catch (err) {
    throw new UploadPutError(UNREACHABLE_STORAGE, { cause: err });
  }
  if (!response.ok) {
    throw new UploadPutError(`upload failed (${response.status})`);
  }
}
