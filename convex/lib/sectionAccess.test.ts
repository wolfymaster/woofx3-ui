import { describe, expect, test } from "bun:test";
import type { LockedSectionReason, SectionVisibility } from "@shared/user-pages";
import { type PageViewer, sectionAccess } from "./sectionAccess";

type Expected = "open" | LockedSectionReason;

const VISIBILITIES: Record<string, SectionVisibility> = {
  public: { kind: "public" },
  signed_in: { kind: "signed_in" },
  follower: { kind: "follower" },
  subscriber: { kind: "subscriber" },
  tier1: { kind: "tier", level: 1 },
  tier2: { kind: "tier", level: 2 },
  tier3: { kind: "tier", level: 3 },
};

const known = (follower: boolean, subscriberTier: 1 | 2 | 3 | null): PageViewer => ({
  kind: "signed_in",
  roles: { kind: "known", follower, subscriberTier },
});

const VIEWERS: Record<string, PageViewer> = {
  anonymous: { kind: "anonymous" },
  "roles unknown": { kind: "signed_in", roles: { kind: "unknown" } },
  uncheckable: { kind: "signed_in", roles: { kind: "uncheckable" } },
  "neither follower nor subscriber": known(false, null),
  follower: known(true, null),
  "tier 1 subscriber, not following": known(false, 1),
  "tier 2 subscriber": known(true, 2),
  "tier 3 subscriber": known(true, 3),
};

// Rows are viewers; columns are public, signed_in, follower, subscriber, tier1, tier2, tier3.
const EXPECTED: Record<string, Expected[]> = {
  anonymous: ["open", "sign_in", "sign_in", "sign_in", "sign_in", "sign_in", "sign_in"],
  "roles unknown": [
    "open",
    "open",
    "roles_unknown",
    "roles_unknown",
    "roles_unknown",
    "roles_unknown",
    "roles_unknown",
  ],
  uncheckable: ["open", "open", "unverifiable", "unverifiable", "unverifiable", "unverifiable", "unverifiable"],
  "neither follower nor subscriber": [
    "open",
    "open",
    "not_eligible",
    "not_eligible",
    "not_eligible",
    "not_eligible",
    "not_eligible",
  ],
  follower: ["open", "open", "open", "not_eligible", "not_eligible", "not_eligible", "not_eligible"],
  "tier 1 subscriber, not following": ["open", "open", "not_eligible", "open", "open", "not_eligible", "not_eligible"],
  "tier 2 subscriber": ["open", "open", "open", "open", "open", "open", "not_eligible"],
  "tier 3 subscriber": ["open", "open", "open", "open", "open", "open", "open"],
};

describe("sectionAccess", () => {
  const visibilityNames = Object.keys(VISIBILITIES);
  for (const [viewerName, viewer] of Object.entries(VIEWERS)) {
    const row = EXPECTED[viewerName];
    if (!row || row.length !== visibilityNames.length) {
      throw new Error(`EXPECTED has no full row for ${viewerName}`);
    }
    visibilityNames.forEach((visibilityName, column) => {
      const expected = row[column];
      test(`${visibilityName} for ${viewerName} is ${expected}`, () => {
        const access = sectionAccess(VISIBILITIES[visibilityName], viewer);
        expect(access).toEqual(expected === "open" ? { kind: "open" } : { kind: "locked", reason: expected });
      });
    });
  }
});
