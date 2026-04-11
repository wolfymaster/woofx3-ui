// Transport factory — picks the correct WoofxTransport implementation
// based on whether we're running in a browser or Tauri desktop app.

import { BrowserTransport } from "./browser-transport";
import { TauriTransport } from "./tauri-transport";
import type { WoofxTransport } from "./interface";

function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

function createTransport(): WoofxTransport {
  if (isTauri()) {
    console.log("[Transport] Running in Tauri — using TauriTransport");
    return new TauriTransport();
  }
  console.log("[Transport] Running in browser — using BrowserTransport");
  return new BrowserTransport();
}

export const transport: WoofxTransport = createTransport();

// Connection is driven by `useSyncEngineTransport` in BroadcastShell so the active
// woofx3 deployment matches the selected Convex instance (per-instance `url` / `apiKey`).

export type { WoofxTransport };
export * from "./interface";
