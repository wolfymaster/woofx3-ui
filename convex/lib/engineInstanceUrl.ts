import { RpcTarget } from "@woofx3/api/client";
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

/**
 * Marker base for authenticated API stubs. Extends both the capnweb
 * RpcTarget marker (proxy typing) and the shared Woofx3EngineApi shape
 * from @woofx3/api, so callers that declare `interface Foo extends EngineApi`
 * automatically get the full engine method surface. RpcTarget is sourced
 * from @woofx3/api/client — Convex code never imports capnweb directly.
 *
 * Per-file RPC interfaces (WoofxEngineRpc, WorkflowEngineRpc, etc.) have
 * been retired; this is the UI's sole local RPC surface type.
 */
export interface EngineApi extends RpcTarget, Woofx3EngineApi {}

/**
 * The unauthenticated entry point for a woofx3 engine instance. Extends
 * ApiGatewayContract from @woofx3/api/rpc (engine-authoritative shape) and
 * adds the capnweb RpcTarget tag locally. If the engine changes a gateway
 * method signature, the shared contract updates and TypeScript enforces
 * the match here without manual mirroring.
 */
export interface ApiGateway extends RpcTarget, ApiGatewayContract {
  // authenticate narrowed to return EngineApi (Woofx3EngineApi + RpcTarget).
  // ApiGatewayContract says Promise<ApiContract>, a structural supertype of
  // EngineApi, so this is a safe covariant override.
  authenticate(clientId: string, clientSecret: string): Promise<EngineApi>;
}
