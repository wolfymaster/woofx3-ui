/**
 * Getting started items the app cannot see happen, so the checklist records
 * them itself: the overlay page confirming the overlay is in the streaming
 * app, a test alert fired from the checklist or the overlay page, the
 * streamer saying they looked at their alerts, and finishing a platform's
 * settings (they are kept on the engine).
 */
export const MANUAL_GETTING_STARTED_ITEM_IDS = ["overlay", "test-alert", "alerts"] as const;

/** Optional items a streamer can wave away for good, so the checklist can finish. */
export const DISMISSIBLE_GETTING_STARTED_ITEM_IDS = [
  "import",
  "starter-packs",
  "optional-platforms",
  "your-page",
] as const;

const PLATFORM_SETTINGS_PREFIX = "platform-settings:";
const DISMISSED_PREFIX = "dismissed:";

/** The item for finishing a chosen platform's settings. */
export function platformSettingsItemId(marketplaceModuleId: string): string {
  return `${PLATFORM_SETTINGS_PREFIX}${marketplaceModuleId}`;
}

/** The platform a platform-settings item is about, or null for any other id. */
export function platformOfSettingsItemId(itemId: string): string | null {
  return itemId.startsWith(PLATFORM_SETTINGS_PREFIX) ? itemId.slice(PLATFORM_SETTINGS_PREFIX.length) || null : null;
}

/** What is recorded when a streamer dismisses an optional item. */
export function dismissedItemId(itemId: string): string {
  return `${DISMISSED_PREFIX}${itemId}`;
}

export function isFixedManualItemId(value: string): boolean {
  return (MANUAL_GETTING_STARTED_ITEM_IDS as readonly string[]).includes(value);
}

export function isDismissedDismissibleItemId(value: string): boolean {
  return (
    value.startsWith(DISMISSED_PREFIX) &&
    (DISMISSIBLE_GETTING_STARTED_ITEM_IDS as readonly string[]).includes(value.slice(DISMISSED_PREFIX.length))
  );
}
