import { describe, expect, test } from "bun:test";
import {
  isBundleListing,
  isModuleListing,
  parseAuthorPage,
  parseBundle,
  parseCatalogCounts,
  parseCatalogDetail,
  parseCatalogListing,
  parseCatalogPage,
} from "./marketplaceCatalog";

// The marketplace API is a separate service on its own release cycle, so these
// parsers exist to keep a shape we do not understand from reaching the UI
// half-formed. That is what is tested here: what survives, and what is dropped.

const iconUrls = {
  sm: "https://m.example/i/sm.webp",
  md: "https://m.example/i/md.webp",
  lg: "https://m.example/i/lg.webp",
};

function listingPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "counter",
    type: "module",
    name: "Counter",
    description: "Counts things.",
    version: "1.2.0",
    author: "Wolfy Master",
    authorSlug: "wolfy-master",
    category: "Utilities",
    tags: ["counting"],
    images: { icon: iconUrls },
    tier: "public",
    credits: [],
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("social proof fields", () => {
  test("install counts and ratings come through as the card shows them", () => {
    const listing = parseCatalogListing(
      listingPayload({
        installCount: 12400,
        weeklyInstallCount: 320,
        rating: 4.8,
        ratingCount: 312,
        authorAvatarUrl: "https://m.example/a.webp",
      })
    );
    expect(listing?.installCount).toBe(12400);
    expect(listing?.weeklyInstallCount).toBe(320);
    expect(listing?.rating).toBe(4.8);
    expect(listing?.ratingCount).toBe(312);
    expect(listing?.authorAvatarUrl).toBe("https://m.example/a.webp");
  });

  test("a listing from a marketplace that counts nothing yet still parses", () => {
    // Drop, don't half-render: the card reserves the stats line and says
    // nothing in it rather than the listing disappearing from the grid.
    const listing = parseCatalogListing(listingPayload());
    expect(listing).not.toBeNull();
    expect(listing?.installCount).toBe(0);
    // A marketplace too old to count the week is the same as a quiet week:
    // the rail has nothing to rank, and says so by not being there.
    expect(listing?.weeklyInstallCount).toBe(0);
    expect(listing?.ratingCount).toBe(0);
    expect(listing?.rating).toBeUndefined();
    expect(listing?.authorAvatarUrl).toBeUndefined();
  });

  test("an unrated listing has no rating, however the API says so", () => {
    for (const rating of [null, 0, -1, 6, "4.8", Number.NaN]) {
      expect(parseCatalogListing(listingPayload({ rating }))?.rating).toBeUndefined();
    }
  });

  test("a nonsense count is 0, not a negative install count on a card", () => {
    expect(parseCatalogListing(listingPayload({ installCount: -5 }))?.installCount).toBe(0);
    expect(parseCatalogListing(listingPayload({ installCount: "many" }))?.installCount).toBe(0);
    expect(parseCatalogListing(listingPayload({ installCount: 4.7 }))?.installCount).toBe(4);
    expect(parseCatalogListing(listingPayload({ weeklyInstallCount: -1 }))?.weeklyInstallCount).toBe(0);
  });

  test("the week cannot exceed all time, whatever the API sends", () => {
    // Nothing enforces this across two numbers from a separate service, so
    // the card reads them independently: it shows the lifetime count, and the
    // rail only ever ranks by the week.
    const listing = parseCatalogListing(listingPayload({ installCount: 5, weeklyInstallCount: 9 }));
    expect(listing?.installCount).toBe(5);
    expect(listing?.weeklyInstallCount).toBe(9);
  });
});

describe("parseCatalogCounts", () => {
  test("every type is present so all five tiles render", () => {
    const counts = parseCatalogCounts({ module: 12, theme: 3 });
    expect(counts).toEqual({ module: 12, theme: 3, emote: 0, overlay: 0, alert: 0 });
  });

  test("reads a wrapped payload as well as a bare one", () => {
    expect(parseCatalogCounts({ counts: { emote: 4 } }).emote).toBe(4);
    expect(parseCatalogCounts(null).alert).toBe(0);
  });
});

describe("parseCatalogListing", () => {
  test("keeps every field the storefront renders", () => {
    const listing = parseCatalogListing(listingPayload());
    expect(listing).not.toBeNull();
    expect(listing?.id).toBe("counter");
    expect(listing?.type).toBe("module");
    expect(listing?.authorSlug).toBe("wolfy-master");
    expect(listing?.tags).toEqual(["counting"]);
    expect(listing?.images.icon).toEqual(iconUrls);
  });

  test("drops an entry with no id or an unknown type", () => {
    expect(parseCatalogListing(listingPayload({ id: "" }))).toBeNull();
    // A type this client cannot render has no card to put it on, and guessing
    // would show it as something it is not.
    expect(parseCatalogListing(listingPayload({ type: "hologram" }))).toBeNull();
    expect(parseCatalogListing(null)).toBeNull();
  });

  test("falls back to the type's own category when a listing declares none", () => {
    // The non-module types have no manifest to carry a category, so the type
    // doubles as one — which is what puts Emotes beside Utilities in the rail.
    const categoryOf = (type: string) => parseCatalogListing(listingPayload({ type, category: undefined }))?.category;
    expect(categoryOf("emote")).toBe("Emotes");
    expect(categoryOf("overlay")).toBe("Overlays");
    expect(categoryOf("alert")).toBe("Alerts");
    expect(categoryOf("theme")).toBe("Themes");
    // A module with no category keeps the module store's own default.
    expect(categoryOf("module")).toBe("Utilities");
    // A declared category always wins over the fallback.
    expect(parseCatalogListing(listingPayload({ type: "emote", category: "Cats" }))?.category).toBe("Cats");
  });

  test("reads a price but treats a non-positive amount as free", () => {
    const paid = parseCatalogListing(listingPayload({ price: { amountCents: 499, currency: "usd" } }));
    expect(paid?.price).toEqual({ amountCents: 499, currency: "usd" });

    // The marketplace refuses a zero price, so seeing one means a shape we do
    // not understand. Rendering the listing as free beats a "Buy for $0.00".
    for (const amountCents of [0, -100]) {
      expect(parseCatalogListing(listingPayload({ price: { amountCents, currency: "usd" } }))?.price).toBeUndefined();
    }
    expect(parseCatalogListing(listingPayload({ price: "free" }))?.price).toBeUndefined();
  });

  test("keeps credits that name someone and drops the ones that do not", () => {
    const listing = parseCatalogListing(
      listingPayload({
        credits: [
          { name: "streamerA", role: "inspiration", url: "https://twitch.tv/streamerA" },
          { role: "inspiration" },
          { name: "streamerB" },
        ],
      })
    );
    expect(listing?.credits.map((credit) => credit.name)).toEqual(["streamerA", "streamerB"]);
    expect(listing?.credits[0].role).toBe("inspiration");
  });

  test("reads the base module a theme needs", () => {
    const theme = parseCatalogListing(listingPayload({ type: "theme", baseModuleId: "counter" }));
    expect(theme?.baseModuleId).toBe("counter");
    expect(parseCatalogListing(listingPayload())?.baseModuleId).toBeUndefined();
  });
});

describe("parseCatalogDetail", () => {
  test("resolves an emote pack's emotes and licence", () => {
    const detail = parseCatalogDetail({
      ...listingPayload({ id: "cozy-cats", type: "emote" }),
      license: "CC-BY-4.0",
      emotes: [
        {
          id: "catJAM",
          name: "catJAM",
          animated: true,
          sizes: { sm: "a", md: "b", lg: "c" },
          original: "d",
        },
        // Missing a size: a grid that fell back per-emote would render at
        // mismatched resolutions, so this one is dropped.
        { id: "broken", sizes: { sm: "a", md: "b" } },
      ],
    });
    expect(detail?.license).toBe("CC-BY-4.0");
    expect(detail?.emotes?.map((emote) => emote.id)).toEqual(["catJAM"]);
    expect(detail?.emotes?.[0].animated).toBe(true);
  });

  test("reads what a bundle listing requires", () => {
    const detail = parseCatalogDetail({
      ...listingPayload({ id: "retro", type: "overlay" }),
      requires: ["counter", 7],
    });
    expect(detail?.requires).toEqual(["counter"]);
  });

  test("keeps a fetched bundle opaque, and reads none from a malformed answer", () => {
    expect(parseBundle({ bundle: { layout: { width: 1920 }, widgets: [{ id: "a" }] } })).toEqual({
      layout: { width: 1920 },
      widgets: [{ id: "a" }],
    });
    expect(parseBundle({ bundle: [] })).toBeNull();
    expect(parseBundle({})).toBeNull();
    expect(parseBundle(null)).toBeNull();
  });

  test("reads the module detail carried inline", () => {
    const detail = parseCatalogDetail({
      ...listingPayload(),
      previews: [
        { kind: "image", url: "https://m.example/a.webp", caption: "in a scene" },
        { kind: "hologram", url: "https://m.example/b" },
        { kind: "video" },
      ],
      module: {
        readme: "# Counter",
        triggers: [{ id: "goal", name: "Goal reached", description: "d" }],
        actions: [{ id: "inc" }],
        functions: [{ id: "f", runtime: "js" }],
        widgets: [{ id: "timer", name: "Timer" }],
        themeable: [{ widgetId: "timer", contractVersion: 2 }, { contractVersion: 1 }],
        themes: [],
        requires: { other: ">=1.0.0", bad: 3 },
      },
    });
    expect(detail?.previews.map((preview) => preview.kind)).toEqual(["image"]);
    expect(detail?.module?.triggers[0].name).toBe("Goal reached");
    // A name is defaulted from the id rather than dropping the entry: an
    // action with no label is still an action the module has.
    expect(detail?.module?.actions[0].name).toBe("inc");
    expect(detail?.module?.themeable).toEqual([{ widgetId: "timer", contractVersion: 2 }]);
    expect(detail?.module?.requires).toEqual({ other: ">=1.0.0" });
  });
});

describe("parseCatalogPage", () => {
  test("keeps the marketplace's total even when an entry is dropped", () => {
    const page = parseCatalogPage({
      listings: [listingPayload(), { id: "", type: "module" }],
      total: 312,
      limit: 48,
      offset: 96,
    });
    expect(page.listings).toHaveLength(1);
    // An unparseable entry must not make "48 of 312" lie about the catalog.
    expect(page.total).toBe(312);
    expect(page.limit).toBe(48);
    expect(page.offset).toBe(96);
  });

  test("survives a payload with no listings at all", () => {
    expect(parseCatalogPage({}).listings).toEqual([]);
    expect(parseCatalogPage(null).total).toBe(0);
  });
});

describe("parseAuthorPage", () => {
  test("reads a claimed profile and its links", () => {
    const page = parseAuthorPage({
      author: {
        slug: "wolfy-master",
        displayName: "WolfyMaster",
        bio: "Builds counters.",
        links: [{ label: "twitch", url: "https://twitch.tv/wolfymaster" }, { label: "no url" }],
        claimed: true,
      },
      listings: [listingPayload()],
      total: 1,
    });
    expect(page?.author.displayName).toBe("WolfyMaster");
    expect(page?.author.claimed).toBe(true);
    expect(page?.author.links).toEqual([{ label: "twitch", url: "https://twitch.tv/wolfymaster" }]);
    expect(page?.listings).toHaveLength(1);
  });

  test("reads an unclaimed page, which is what every older author has", () => {
    const page = parseAuthorPage({
      author: { slug: "wolfy-master", displayName: "Wolfy Master", claimed: false },
      listings: [],
      total: 0,
    });
    expect(page?.author.claimed).toBe(false);
    expect(page?.author.bio).toBeUndefined();
    expect(page?.author.links).toEqual([]);
  });

  test("is null without a slug, because there is no page to address", () => {
    expect(parseAuthorPage({ author: {}, listings: [] })).toBeNull();
    expect(parseAuthorPage(null)).toBeNull();
  });
});

describe("install path by type", () => {
  test("modules and themes install through the module path", () => {
    expect(isModuleListing("module")).toBe(true);
    // A theme pack *is* a module archive, which is what lets it install with
    // no new plumbing.
    expect(isModuleListing("theme")).toBe(true);
    expect(isModuleListing("emote")).toBe(false);
  });

  test("overlays and alerts install by writing a scene or composition", () => {
    expect(isBundleListing("overlay")).toBe(true);
    expect(isBundleListing("alert")).toBe(true);
    expect(isBundleListing("module")).toBe(false);
    // An emote pack installs nothing at all: it is images.
    expect(isBundleListing("emote")).toBe(false);
  });
});
