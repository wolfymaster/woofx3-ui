import { DEFAULT_ENGINE_SESSION_CONFIG, type EngineSessionConfig } from "@/lib/engine-session/config";
import { requirePositiveInteger } from "@/lib/engine-session/deps";

export interface DirectGatewayConfig {
  session: EngineSessionConfig;
  /** How long a transient event stays readable after it arrives, in ms. */
  transientTtlMs: number;
  /** The most transient events kept under one correlation key; the oldest go first. */
  transientsPerKey: number;
  /** How many recent envelope ids the event sink remembers to drop a second delivery of one event. */
  seenEnvelopeIds: number;
  /** How many times a read is tried before its error reaches the screen, the first try included. */
  queryAttempts: number;
  /**
   * How long stream-event subscriptions may keep changing before the engine
   * is told the types they want, in ms, so a screen mounting several of them
   * registers once.
   */
  streamRegistrationDelayMs: number;
  /** Workflows asked for per page when every workflow is read; the engine pages its list. */
  workflowPageSize: number;
  /** Most pages one read of every workflow goes through before it gives up, so a misbehaving engine cannot loop it. */
  workflowMaxPages: number;
}

export const DEFAULT_DIRECT_GATEWAY_CONFIG: DirectGatewayConfig = {
  session: DEFAULT_ENGINE_SESSION_CONFIG,
  // Match the Convex gateway's transientEvents TTL and per-key read bound
  // (convex/transientEvents.ts), so a screen sees the same window either way.
  transientTtlMs: 60_000,
  transientsPerKey: 200,
  seenEnvelopeIds: 512,
  queryAttempts: 3,
  streamRegistrationDelayMs: 100,
  workflowPageSize: 100,
  workflowMaxPages: 1000,
};

export function validateDirectGatewayConfig(config: DirectGatewayConfig): void {
  requirePositiveInteger("DirectGateway", "transientTtlMs", config.transientTtlMs);
  requirePositiveInteger("DirectGateway", "transientsPerKey", config.transientsPerKey);
  requirePositiveInteger("DirectGateway", "seenEnvelopeIds", config.seenEnvelopeIds);
  requirePositiveInteger("DirectGateway", "queryAttempts", config.queryAttempts);
  requirePositiveInteger("DirectGateway", "streamRegistrationDelayMs", config.streamRegistrationDelayMs);
  requirePositiveInteger("DirectGateway", "workflowPageSize", config.workflowPageSize);
  requirePositiveInteger("DirectGateway", "workflowMaxPages", config.workflowMaxPages);
}
