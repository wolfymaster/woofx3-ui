import { describe, expect, it } from "bun:test";
import { syncReportToast } from "@/lib/scene-sync-report";

describe("syncReportToast", () => {
  it("names what went with a deleted scene", () => {
    expect(
      syncReportToast(
        {
          reason: "gone",
          items: [
            { kind: "edits", version: "draft", sent: false },
            { kind: "publish", maybeRan: false },
          ],
        },
        "Main"
      )
    ).toEqual({
      title: '"Main" no longer exists',
      description: "It was deleted, so changes to the draft weren't saved and Publish wasn't sent.",
    });
    expect(syncReportToast({ reason: "gone", items: [] }, undefined)).toEqual({
      title: "The scene no longer exists",
      description: "It was deleted.",
    });
  });

  it("tells sent from unsent work left when the editor closed", () => {
    const toast = syncReportToast(
      {
        reason: "closed",
        items: [
          { kind: "edits", version: "published", sent: true },
          { kind: "discard", maybeRan: true },
        ],
      },
      "Main"
    );
    expect(toast.title).toBe("Your last changes may not have been saved");
    expect(toast.description).toBe(
      'The editor for "Main" closed before everything was saved: live changes may not have been saved and Discard may have gone through. Open the scene to check it.'
    );
  });

  it("says a session that ended with nothing pending disconnected", () => {
    expect(syncReportToast({ reason: "closed", items: [] }, "Main")).toEqual({
      title: "The scene editor disconnected",
      description: 'The editor for "Main" lost its connection. Open the scene again to keep editing.',
    });
  });

  it("gives a refused command its own title", () => {
    expect(
      syncReportToast(
        { reason: "rejected", items: [{ kind: "publish", maybeRan: false }], detail: "too large" },
        "Main"
      )
    ).toEqual({
      title: "Publish didn't go through",
      description: 'Couldn\'t publish the draft of "Main". Try again.',
    });
  });

  it("says a refused edit was undone", () => {
    expect(
      syncReportToast(
        { reason: "rejected", items: [{ kind: "edits", version: "draft", sent: true }], detail: "opacity is 0..1" },
        undefined
      )
    ).toEqual({
      title: "This change couldn't be saved",
      description: "A change to the scene was undone in the editor. Try again.",
    });
  });

  it("explains lost history", () => {
    const toast = syncReportToast({ reason: "history_lost", items: [] }, "Main");
    expect(toast.title).toBe("Some recent changes were lost");
    expect(toast.description).toContain('the last changes to "Main"');
  });
});
