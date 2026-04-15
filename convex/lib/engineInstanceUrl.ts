import { RpcTarget, type RpcCompatible, newHttpBatchRpcSession } from "capnweb";

export { RpcTarget };

/**
 * The unauthenticated entry point for a woofx3 engine instance.
 * Exposed via capnweb — connect to the engine URL and get a Gateway stub.
 */
export interface ApiGateway extends RpcTarget {
  ping(): Promise<{ status: string }>;
  registerClient(
    description: string,
    callbackUrl: string,
    callbackToken: string,
  ): Promise<{ clientId: string; clientSecret: string }>;
  authenticate(clientId: string, clientSecret: string): Promise<EngineApi>;
}

/**
 * The authenticated API surface returned by gateway.authenticate().
 * Individual RPC interfaces in each file extend this or use it as a base.
 */
export interface EngineApi extends RpcTarget {
  // Marker interface — concrete method signatures are declared by callers
  // via their own RPC interfaces that extend EngineApi.
}

/**
 * Normalize user-configured instance URL to the woofx3 HTTP batch RPC base (`.../api`).
 */
export function engineApiUrl(instanceUrl: string): string {
  const trimmed = instanceUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const u = new URL(trimmed);
    return `${u.origin}/api`;
  }
  return `http://${trimmed}/api`;
}

/**
 * Create an unauthenticated capnweb Gateway session for a given engine URL.
 */
export function createGatewaySession(instanceUrl: string) {
  const url = engineApiUrl(instanceUrl);
  return newHttpBatchRpcSession<ApiGateway>(url);
}

/**
 * Create an authenticated capnweb RPC session for a given engine URL.
 *
 * Connects to the Gateway and calls authenticate(clientId, clientSecret)
 * to get back an Api stub. The authenticate call is NOT awaited — it is
 * pipelined with the caller's next API call into a single HTTP batch request.
 *
 * IMPORTANT (capnweb HTTP batch constraint): With newHttpBatchRpcSession,
 * the entire batch is sent on the FIRST await. After that await the session
 * is consumed. This means:
 *   - Do NOT await the return value of this function before calling an API method.
 *   - Chain the API call directly: `const result = await createEngineRpcSession(...).someMethod()`
 *   - Multiple API calls require separate sessions (one createEngineRpcSession per batch).
 */
export function createEngineRpcSession<T extends RpcCompatible<T>>(
  instanceUrl: string,
  clientId: string,
  clientSecret: string,
) {
  const gateway = createGatewaySession(instanceUrl);
  // Not awaited — pipelined into the same HTTP batch as the caller's API call.
  return gateway.authenticate(clientId, clientSecret) as unknown as T;
}
