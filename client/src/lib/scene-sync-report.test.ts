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
      description:
        "The scene manager doesn't have it any more, so changes to the draft weren't saved and Publish wasn't sent.",
    });
    expect(syncReportToast({ reason: "gone", items: [] }, undefined)).toEqual({
      title: "The scene no longer exists",
      description: "The scene manager doesn't have it any more.",
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
      'The editor for "Main" closed before the scene manager confirmed everything: live changes may not have been saved and Discard may have gone through. Open the scene to check it.'
    );
  });

  it("says a session that ended with nothing pending disconnected", () => {
    expect(
      syncReportToast({ reason: "closed", items: [], detail: "this engine speaks scene editor protocol 3" }, "Main")
    ).toEqual({
      title: "The scene editor disconnected",
      description:
        'The editor for "Main" lost its connection to the scene manager (this engine speaks scene editor protocol 3). Open the scene again to keep editing.',
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
      description: 'The scene manager refused to publish the draft of "Main": too large.',
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
      description: "The scene manager refused a change to the scene: opacity is 0..1. It was undone in the editor.",
    });
  });

  it("explains lost history", () => {
    const toast = syncReportToast({ reason: "history_lost", items: [] }, "Main");
    expect(toast.title).toBe("The scene manager lost recent changes");
    expect(toast.description).toContain('the last changes to "Main"');
  });
});
