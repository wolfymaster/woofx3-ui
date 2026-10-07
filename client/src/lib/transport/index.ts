// Connection is driven by `useSyncEngineTransport` in BroadcastShell so the active
// woofx3 deployment matches the selected Convex instance (per-instance `url` / `clientId` / `clientSecret`).

import { BrowserTransport } from "./browser-transport";
import type { WoofxTransport } from "./interface";

export const transport: WoofxTransport = new BrowserTransport();

export type { WoofxTransport };
export * from "./interface";
