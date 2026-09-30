/**
 * Getting started items the app cannot see happen, so the checklist records
 * them itself: firing a test follow from the card, and the streamer saying
 * they tried a chat command (the engine reports no event for a command run).
 */
export const MANUAL_GETTING_STARTED_ITEM_IDS = ["test-follow", "chat-command"] as const;

export type ManualGettingStartedItemId = (typeof MANUAL_GETTING_STARTED_ITEM_IDS)[number];

export function isManualGettingStartedItemId(value: string): value is ManualGettingStartedItemId {
  return (MANUAL_GETTING_STARTED_ITEM_IDS as readonly string[]).includes(value);
}
