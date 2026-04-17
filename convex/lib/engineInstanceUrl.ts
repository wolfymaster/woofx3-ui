import { RpcTarget, type RpcCompatible, newHttpBatchRpcSession } from "capnweb";
import type { ApiGatewayContract } from "@woofx3/api/rpc";
import type { StreamControlApi } from "@woofx3/api";

export { RpcTarget };

/**
 * Marker base for authenticated API stubs. Extends both capnweb's RpcTarget
 * (required for capnweb proxy typing) and the shared StreamControlApi shape
 * from @woofx3/api, so callers that declare `interface Foo extends EngineApi`
 * automatically get access to every method the engine exposes in the shared
 * type package.
 *
 * Per-file RPC interfaces (WoofxEngineRpc, WorkflowEngineRpc, etc.) will be
 * retired as the UI migrates to use EngineApi directly.
 */
export interface EngineApi extends RpcTarget, StreamControlApi {}

/**
 * The unauthenticated entry point for a woofx3 engine instance.
 * Exposed via capnweb — connect to the engine URL and get a Gateway stub.
 *
 * Extends ApiGatewayContract from @woofx3/api/rpc (the engine's authoritative
 * shape) and adds the capnweb RpcTarget tag locally. If the engine changes
 * a gateway method signature and the shared contract updates, TypeScript
 * enforces the match here without manual mirroring.
 */
export interface ApiGateway extends RpcTarget, ApiGatewayContract {
  // authenticate narrowed to return EngineApi (StreamControlApi + RpcTarget).
  // ApiGatewayContract says Promise<ApiContract> which is a structural
  // supertype of EngineApi, so this is a safe covariant override.
  authenticate(clientId: string, clientSecret: string): Promise<EngineApi>;
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
