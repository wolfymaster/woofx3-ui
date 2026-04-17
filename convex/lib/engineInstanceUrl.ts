import { RpcTarget } from "capnweb";
import type { ApiGatewayContract } from "@woofx3/api/rpc";
import type { Woofx3EngineApi } from "@woofx3/api";

// Re-export the SDK's capnweb session helpers + URL normalizer so everything
// engine-related funnels through one import path in Convex code. The actual
// implementations live in @woofx3/api/client.
export {
  createEngineGatewaySession,
  createEngineSession as createEngineRpcSession,
  engineApiUrl,
} from "@woofx3/api/client";
export { RpcTarget };

/**
 * Marker base for authenticated API stubs. Extends both capnweb's RpcTarget
 * (required for capnweb proxy typing) and the shared Woofx3EngineApi shape
 * from @woofx3/api, so callers that declare `interface Foo extends EngineApi`
 * automatically get access to every method the engine exposes in the shared
 * type package.
 *
 * Per-file RPC interfaces (WoofxEngineRpc, WorkflowEngineRpc, etc.) will be
 * retired as the UI migrates to use EngineApi directly.
 */
export interface EngineApi extends RpcTarget, Woofx3EngineApi {}

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
  // authenticate narrowed to return EngineApi (Woofx3EngineApi + RpcTarget).
  // ApiGatewayContract says Promise<ApiContract> which is a structural
  // supertype of EngineApi, so this is a safe covariant override.
  authenticate(clientId: string, clientSecret: string): Promise<EngineApi>;
}
