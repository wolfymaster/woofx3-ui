// Connection is driven by the Convex gateway's `useLiveConnection` (engine/convex/session.ts),
// mounted in BroadcastShell, so the active woofx3 deployment matches the selected Convex
// instance (per-instance `url` / `clientId` / `clientSecret`).

import { appLogger } from "@/lib/app-logger";
import { BrowserTransport } from "./browser-transport";
import type { WoofxTransport } from "./interface";

export const transport: WoofxTransport = new BrowserTransport(appLogger.scoped("transport"));

export type { WoofxTransport };
export * from "./interface";
