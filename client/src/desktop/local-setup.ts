import type { DashboardPanelWidget } from "@shared/dashboard-layout";
import { DEFAULT_DASHBOARD_WIDGETS } from "@shared/default-seed";
import type { DefaultSeedStatus, InstalledModule } from "@/engine/types";
import { bareModuleKey } from "@/lib/module-key";

/** The Twitch module setup connects and installs. Must match TWITCH_SETUP_MODULE_ID in convex/lib/setupPlatforms.ts. */
export const TWITCH_MODULE_ID = "woofx3_twitch";

/** The setup steps local mode serves; it has no engine to wait for, so no "finish" step. */
export type LocalSetupStep = "connect" | "overlay";

/**
 * Connecting (or skipping) installs the Twitch module, so its being installed
 * is what records that the connect page is done.
 */
export function twitchModuleInstalled(modules: readonly InstalledModule[]): boolean {
  return modules.some(
    (module) => module.status === "installed" && bareModuleKey(module.moduleKey) === TWITCH_MODULE_ID
  );
}

/**
 * The page a local setup belongs on. Nothing comes before connecting, and a
 * connected setup moves on from the connect page by itself, as hosted setup does.
 * `justConnected` covers the moments before the module's install lands.
 */
export function localSetupStep(connected: boolean, justConnected: boolean): LocalSetupStep {
  return connected || justConnected ? "overlay" : "connect";
}

/** Whether local mode still owes its first run: the overlay page was neither finished nor skipped. */
export function localSetupPending(seed: Pick<DefaultSeedStatus, "overlayDone">): boolean {
  return seed.overlayDone === null;
}

/**
 * The waits before each apply of the default seed while setup runs. Its alerts
 * stay pending until the Twitch module's install lands and its triggers exist,
 * which the first apply can beat; each later apply picks up what is still pending.
 */
export const SEED_APPLY_DELAYS_MS = [0, 5_000, 15_000, 30_000, 60_000, 120_000] as const;

export function seedHasPending(seed: Pick<DefaultSeedStatus, "scene" | "alerts">): boolean {
  return seed.scene.status === "pending" || seed.alerts.some((alert) => alert.status === "pending");
}

/** The first dashboard panel's widgets, leaving out any the local dashboard cannot show. */
export function localDefaultDashboardWidgets(localWidgetTypes: ReadonlySet<string>): DashboardPanelWidget[] {
  return DEFAULT_DASHBOARD_WIDGETS.filter((widget) => localWidgetTypes.has(widget.type)).map((widget) => ({
    ...widget,
  }));
}
