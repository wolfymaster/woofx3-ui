import { describe, expect, test } from "bun:test";
import type { PublicPageLookup } from "@shared/user-pages";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { type LookupKey, mayStandIn, useLookupWhileLoading } from "./lookup-while-loading";

describe("mayStandIn", () => {
  const anonymous = (slug: string): LookupKey => ({ slug, sessionToken: null });
  const signedIn = (slug: string, sessionToken: string): LookupKey => ({ slug, sessionToken });
  const cases: Array<{ name: string; previous: LookupKey; next: LookupKey; standsIn: boolean }> = [
    { name: "anonymous, then signed in", previous: anonymous("wolfy"), next: signedIn("wolfy", "a"), standsIn: true },
    { name: "the same session", previous: signedIn("wolfy", "a"), next: signedIn("wolfy", "a"), standsIn: true },
    { name: "signed in, then signed out", previous: signedIn("wolfy", "a"), next: anonymous("wolfy"), standsIn: false },
    { name: "another viewer", previous: signedIn("wolfy", "a"), next: signedIn("wolfy", "b"), standsIn: false },
    { name: "another slug", previous: anonymous("wolfy"), next: anonymous("howl"), standsIn: false },
    { name: "another slug, signing in", previous: anonymous("wolfy"), next: signedIn("howl", "a"), standsIn: false },
  ];
  for (const { name, previous, next, standsIn } of cases) {
    test(`${name}: ${standsIn ? "stands in" : "does not"}`, () => {
      expect(mayStandIn(previous, next)).toBe(standsIn);
    });
  }
});

const PAGE: PublicPageLookup = {
  kind: "page",
  slug: "wolfy",
  layout: "single",
  theme: { accent: "teal" },
  sections: [],
  rolesStale: false,
  rolesRenewAt: null,
  publishedAt: 1,
};
const SIGNED_IN_PAGE: PublicPageLookup = { ...PAGE, publishedAt: 2 };

let shown: PublicPageLookup | undefined;

function Probe({ lookupKey, lookup }: { lookupKey: LookupKey; lookup: PublicPageLookup | undefined }) {
  shown = useLookupWhileLoading(lookupKey, lookup);
  return null;
}

describe("useLookupWhileLoading", () => {
  async function render(steps: Array<{ lookupKey: LookupKey; lookup: PublicPageLookup | undefined }>) {
    let renderer: ReactTestRenderer | undefined;
    const seen: Array<PublicPageLookup | undefined> = [];
    for (const step of steps) {
      await act(async () => {
        if (renderer) {
          renderer.update(<Probe {...step} />);
        } else {
          renderer = create(<Probe {...step} />);
        }
      });
      seen.push(shown);
    }
    return seen;
  }

  test("keeps the anonymous page on screen while the signed-in read loads, then shows it", async () => {
    const seen = await render([
      { lookupKey: { slug: "wolfy", sessionToken: null }, lookup: undefined },
      { lookupKey: { slug: "wolfy", sessionToken: null }, lookup: PAGE },
      { lookupKey: { slug: "wolfy", sessionToken: "a" }, lookup: undefined },
      { lookupKey: { slug: "wolfy", sessionToken: "a" }, lookup: SIGNED_IN_PAGE },
    ]);
    expect(seen).toEqual([undefined, PAGE, PAGE, SIGNED_IN_PAGE]);
  });

  test("shows nothing from another slug or from a session that has ended", async () => {
    const seen = await render([
      { lookupKey: { slug: "wolfy", sessionToken: "a" }, lookup: SIGNED_IN_PAGE },
      { lookupKey: { slug: "wolfy", sessionToken: null }, lookup: undefined },
      { lookupKey: { slug: "wolfy", sessionToken: null }, lookup: PAGE },
      { lookupKey: { slug: "howl", sessionToken: null }, lookup: undefined },
    ]);
    expect(seen).toEqual([SIGNED_IN_PAGE, undefined, PAGE, undefined]);
  });
});
