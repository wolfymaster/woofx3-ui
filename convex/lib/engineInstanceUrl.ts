import { type RpcCompatible, newHttpBatchRpcSession } from "capnweb";

/**
 * Normalize user-configured instance URL to the woofx3 HTTP batch RPC base (`.../api`).
 */
export function engineHttpBatchApiUrl(instanceUrl: string): string {
  const trimmed = instanceUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const u = new URL(trimmed);
    return `${u.origin}/api`;
  }
  return `http://${trimmed}/api`;
}

/**
 * Create an authenticated capnweb HTTP batch RPC session for a given engine URL.
 * If an API key is provided, it's included in the Authorization header.
 */
export function createEngineRpcSession<T extends RpcCompatible<T>>(instanceUrl: string, apiKey?: string | null) {
  const url = engineHttpBatchApiUrl(instanceUrl);
  if (apiKey) {
    const request = new Request(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return newHttpBatchRpcSession<T>(request);
  }
  return newHttpBatchRpcSession<T>(url);
}
