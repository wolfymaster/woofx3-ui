import { describe, expect, it } from "bun:test";
import {
  endedUnreadable,
  repairResultToast,
  unreadColumnsText,
  unreadPlacementCount,
  unreadPlacementsText,
} from "./scene-unread";

const none = { published: 0, draft: 0 };

describe("unreadColumnsText", () => {
  it("names each column by what it holds and whose it is", () => {
    expect(unreadColumnsText({ columns: [{ version: "published", column: "widgets" }], placements: none })).toBe(
      "the published layers"
    );
    expect(
      unreadColumnsText({
        columns: [
          { version: "published", column: "layout" },
          { version: "draft", column: "widgets" },
          { version: "draft", column: "behaviors" },
        ],
        placements: none,
      })
    ).toBe("the published canvas settings, the draft's layers and the draft's animations");
  });
});

describe("unreadPlacementCount", () => {
  it("adds both versions", () => {
    expect(unreadPlacementCount({ columns: [], placements: { published: 2, draft: 1 } })).toBe(3);
  });
});

describe("unreadPlacementsText", () => {
  it("speaks of one layer in the singular", () => {
    expect(unreadPlacementsText(1)).toBe("It's kept as it was stored, but isn't shown or played.");
  });

  it("speaks of several in the plural", () => {
    expect(unreadPlacementsText(3)).toBe("They're kept as they were stored, but aren't shown or played.");
  });
});

describe("endedUnreadable", () => {
  const blocked = { columns: [{ version: "published" as const, column: "layout" as const }], placements: none };

  it("is true only for a session that ended over a column it could not read", () => {
    expect(endedUnreadable("gone", blocked)).toBe(true);
    expect(endedUnreadable("gone", null)).toBe(false);
    expect(endedUnreadable("gone", { columns: [], placements: { published: 1, draft: 0 } })).toBe(false);
    expect(endedUnreadable("ready", blocked)).toBe(false);
  });
});

describe("repairResultToast", () => {
  it("says how many backups the engine kept, or that nothing needed repairing", () => {
    expect(repairResultToast({ ok: true, backups: 2 }, "scene")).toEqual({
      title: "Scene repaired",
      description: "The engine kept a copy of what it couldn't read (2 backups).",
    });
    expect(repairResultToast({ ok: true, backups: 0 }, "alert").description).toBe(
      "Nothing in this alert needed repairing."
    );
  });

  it("explains each refusal, with nothing changed", () => {
    expect(repairResultToast({ ok: false, reason: "unavailable", detail: "" }, "scene")).toMatchObject({
      variant: "destructive",
      description: expect.stringContaining("Try again"),
    });
    expect(
      repairResultToast({ ok: false, reason: "failed", detail: "the repaired scene could not be saved" }, "scene")
        .description
    ).toBe("Nothing was changed: the repaired scene could not be saved.");
  });
});
