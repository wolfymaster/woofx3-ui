import { describe, expect, it } from "bun:test";
import { alertLayoutChanged, readAlertComposition } from "./alert-layout";
import { localCopySource, socketDraftSource } from "./editor-document-source";

const seed = readAlertComposition({ width: 1280, height: 720, widgets: [] }, (id) => id);

describe("localCopySource", () => {
  it("reports unchanged until the copy is edited, so Done has nothing to return", () => {
    const copy = localCopySource(seed, alertLayoutChanged);
    const doc = copy.source.getDocument();
    expect(copy.kind).toBe("local-copy");
    expect(copy.changed(doc)).toBe(false);
    const edited = { ...doc, layout: { ...doc.layout, width: 640 } };
    expect(copy.changed(edited)).toBe(true);
  });

  it("does not touch the seed it was made from", () => {
    const copy = localCopySource(seed, alertLayoutChanged);
    copy.source.replace({ ...seed, layout: { ...seed.layout, width: 1 } });
    expect(seed.layout.width).toBe(1280);
  });
});

describe("socketDraftSource", () => {
  it("sends publish and discard to the session and reports whether they were taken", () => {
    const sent: string[] = [];
    const client = {
      publish: () => {
        sent.push("publish");
        return true;
      },
      discard: () => {
        sent.push("discard");
        return false;
      },
    };
    const draft = socketDraftSource(client as never, "draft");
    expect(draft.kind).toBe("socket-draft");
    expect(draft.version).toBe("draft");
    expect(draft.publish()).toBe(true);
    expect(draft.discard()).toBe(false);
    expect(sent).toEqual(["publish", "discard"]);
  });
});
