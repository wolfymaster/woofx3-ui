import type { SceneSyncState } from "@woofx3/api/scene-editor/client";

/**
 * Where a sync editor's edits are. `sending`: on their way to the scene manager.
 * `retrying`: a send failed and is being retried. `draft`: saved, but waiting in a draft
 * that has not been published, so its audience does not see them yet. `saved`: saved and
 * where they show, because live updating sent them there or there is no draft.
 */
export type DraftSaveStatus = "sending" | "retrying" | "draft" | "saved";

export function draftSaveStatus(state: SceneSyncState | null, live: boolean): DraftSaveStatus {
  if (state === null) {
    return "saved";
  }
  if (state.retrying) {
    return "retrying";
  }
  if (state.pendingItems > 0) {
    return "sending";
  }
  return !live && state.hasDraft ? "draft" : "saved";
}
