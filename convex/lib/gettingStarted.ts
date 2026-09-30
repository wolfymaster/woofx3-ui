/**
 * Getting started items the app cannot see happen, so the checklist records
 * them itself: firing a test follow from the card, the streamer saying they
 * tried a chat command (the engine reports no event for a command run), and
 * finishing a platform's settings (they are kept on the engine).
 */
export const MANUAL_GETTING_STARTED_ITEM_IDS = ["test-follow", "chat-command"] as const;

const PLATFORM_SETTINGS_PREFIX = "platform-settings:";

/** The item for finishing a chosen platform's settings. */
export function platformSettingsItemId(marketplaceModuleId: string): string {
  return `${PLATFORM_SETTINGS_PREFIX}${marketplaceModuleId}`;
}

/** The platform a platform-settings item is about, or null for any other id. */
export function platformOfSettingsItemId(itemId: string): string | null {
  return itemId.startsWith(PLATFORM_SETTINGS_PREFIX) ? itemId.slice(PLATFORM_SETTINGS_PREFIX.length) || null : null;
}

export function isFixedManualItemId(value: string): boolean {
  return (MANUAL_GETTING_STARTED_ITEM_IDS as readonly string[]).includes(value);
}
