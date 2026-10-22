import { invoke } from "@tauri-apps/api/core";

/**
 * What the webview needs to open its own capnweb session with the local
 * engine. Must match `LocalEngineSession` in companion/src-tauri/src/state.rs
 * (serde tag = "kind").
 */
export type LocalEngineSession =
  | { kind: "notLocal" }
  | { kind: "starting" }
  | { kind: "ready"; apiUrl: string; clientId: string; clientSecret: string }
  | { kind: "failed"; reason: string };

/** Must match `local_engine_session` in companion/src-tauri/src/lib.rs. It takes no arguments. */
export const LOCAL_ENGINE_SESSION_COMMAND = "local_engine_session";

export type LocalEngineSessionArgs = Record<string, never>;

export async function localEngineSession(): Promise<LocalEngineSession> {
  const args: LocalEngineSessionArgs = {};
  return invoke<LocalEngineSession>(LOCAL_ENGINE_SESSION_COMMAND, args);
}
