import { describe, expect, it } from "bun:test";
import type { SceneSyncState } from "@woofx3/api/scene-editor/client";
import { type DraftSaveStatus, draftSaveStatus } from "./draft-save-status";

function syncState(overrides: Partial<SceneSyncState>): SceneSyncState {
  return { pendingItems: 0, retrying: false, hasDraft: false, ...overrides } as SceneSyncState;
}

describe("draftSaveStatus", () => {
  const cases: Array<[string, Partial<SceneSyncState>, boolean, DraftSaveStatus]> = [
    ["a draft that has been saved but not published", { hasDraft: true }, false, "draft"],
    ["no draft while not live updating", {}, false, "saved"],
    ["live updating, whether or not a draft is left over", { hasDraft: true }, true, "saved"],
    ["edits still on their way", { pendingItems: 2, hasDraft: true }, false, "sending"],
    ["edits on their way while live updating", { pendingItems: 1 }, true, "sending"],
    ["a send being retried, over edits still on their way", { pendingItems: 1, retrying: true }, false, "retrying"],
  ];
  for (const [name, state, live, expected] of cases) {
    it(`is ${expected} for ${name}`, () => {
      expect(draftSaveStatus(syncState(state), live)).toBe(expected);
    });
  }

  it("is saved before the session has reported anything", () => {
    expect(draftSaveStatus(null, false)).toBe("saved");
  });
});
