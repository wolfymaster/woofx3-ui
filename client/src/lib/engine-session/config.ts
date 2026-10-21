import { requirePositiveInteger } from "./deps";

/** Every duration is in ms. */
export interface EngineSessionConfig {
  /** First reconnect delay, before jitter. */
  reconnectBaseMs: number;
  /** Ceiling the reconnect delay grows to and stays at, before jitter. */
  reconnectMaxMs: number;
  /** How long a new session has to prove itself: the capability read plus the host's attach step. */
  connectTimeoutMs: number;
  /** How long one call may wait for the engine's answer. capnweb sets no deadline of its own. */
  rpcTimeoutMs: number;
}

export const DEFAULT_ENGINE_SESSION_CONFIG: EngineSessionConfig = {
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
  connectTimeoutMs: 10_000,
  rpcTimeoutMs: 15_000,
};

export function validateEngineSessionConfig(config: EngineSessionConfig): void {
  requirePositiveInteger("EngineSession", "reconnectBaseMs", config.reconnectBaseMs);
  requirePositiveInteger("EngineSession", "reconnectMaxMs", config.reconnectMaxMs);
  requirePositiveInteger("EngineSession", "connectTimeoutMs", config.connectTimeoutMs);
  requirePositiveInteger("EngineSession", "rpcTimeoutMs", config.rpcTimeoutMs);
  if (config.reconnectMaxMs < config.reconnectBaseMs) {
    throw new Error("EngineSession: reconnectMaxMs must be at least reconnectBaseMs");
  }
}
