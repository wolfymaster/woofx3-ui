import { describe, expect, test } from "bun:test";
import {
  ADMINS_ONLY_MESSAGE,
  NO_SLUG_MESSAGE,
  NOT_ENTITLED_MESSAGE,
  type PublishFacts,
  pageStatus,
  publishGate,
  unpublishGate,
} from "@/lib/user-page-publishing";

const ready: PublishFacts = {
  isAdmin: true,
  slug: "wolfy",
  canPublish: true,
  draftRevision: 2,
  published: null,
  dirty: false,
  hasProblems: false,
};

describe("pageStatus", () => {
  test("never published", () => {
    expect(pageStatus(ready)).toEqual({ kind: "unpublished" });
  });

  test("live with the saved draft", () => {
    expect(pageStatus({ ...ready, published: { revision: 2, publishedAt: 10 } })).toEqual({
      kind: "live",
      publishedAt: 10,
    });
  });

  test("live with a newer draft saved", () => {
    expect(pageStatus({ ...ready, published: { revision: 1, publishedAt: 10 } })).toEqual({
      kind: "live_behind",
      publishedAt: 10,
    });
  });
});

describe("publishGate", () => {
  test("an admin with a saved, clean draft may publish", () => {
    expect(publishGate(ready)).toEqual({ kind: "enabled" });
  });

  test("a member sees the button disabled with the reason", () => {
    expect(publishGate({ ...ready, isAdmin: false })).toEqual({ kind: "disabled", reason: ADMINS_ONLY_MESSAGE });
  });

  test("an engine without an address cannot publish", () => {
    expect(publishGate({ ...ready, slug: null })).toEqual({ kind: "disabled", reason: NO_SLUG_MESSAGE });
  });

  test("a plan without pages cannot publish", () => {
    expect(publishGate({ ...ready, canPublish: false })).toEqual({ kind: "disabled", reason: NOT_ENTITLED_MESSAGE });
  });

  test("the role is the reason shown when several apply", () => {
    expect(publishGate({ ...ready, isAdmin: false, slug: null, dirty: true })).toEqual({
      kind: "disabled",
      reason: ADMINS_ONLY_MESSAGE,
    });
  });

  test("problems, unsaved edits and a never-saved draft each wait", () => {
    expect(publishGate({ ...ready, hasProblems: true }).kind).toBe("disabled");
    expect(publishGate({ ...ready, dirty: true }).kind).toBe("disabled");
    expect(publishGate({ ...ready, draftRevision: 0 }).kind).toBe("disabled");
  });

  test("nothing to publish when visitors already see the draft", () => {
    expect(publishGate({ ...ready, published: { revision: 2, publishedAt: 1 } }).kind).toBe("disabled");
    expect(publishGate({ ...ready, published: { revision: 1, publishedAt: 1 } })).toEqual({ kind: "enabled" });
  });
});

describe("unpublishGate", () => {
  const live = { ...ready, published: { revision: 2, publishedAt: 1 } };

  test("hidden while the page is not published", () => {
    expect(unpublishGate(ready)).toEqual({ kind: "hidden" });
  });

  test("an admin may take a live page offline", () => {
    expect(unpublishGate(live)).toEqual({ kind: "enabled" });
  });

  test("a member sees why they cannot", () => {
    expect(unpublishGate({ ...live, isAdmin: false })).toEqual({ kind: "disabled", reason: ADMINS_ONLY_MESSAGE });
  });
});
