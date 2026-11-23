import { describe, expect, test } from "bun:test";
import { parse } from "regexparam";
import {
  installedModulePath,
  isMarketplaceFront,
  legacyModulesRedirect,
  MARKETPLACE_AUTHOR_ROUTE,
  MARKETPLACE_BROWSE_ROUTE,
  MARKETPLACE_LISTING_ROUTE,
  MARKETPLACE_PATH,
  MODULES_MODULE_ROUTE,
  MODULES_PATH,
  marketplaceAuthorPath,
  marketplaceCategoryPath,
  marketplaceFilterPath,
  marketplaceListingPath,
  parseMarketplaceFilter,
} from "./marketplace-route";

describe("marketplace paths", () => {
  test("a listing path matches the route that renders it", () => {
    // The two drifting apart is a dead link, and nothing else would catch it:
    // Wouter silently falls through to the 404 route.
    expect(MARKETPLACE_LISTING_ROUTE).toBe(`${MARKETPLACE_PATH}/listing/:listingId`);
    expect(MARKETPLACE_AUTHOR_ROUTE).toBe(`${MARKETPLACE_PATH}/author/:slug`);
    expect(marketplaceListingPath("counter")).toBe("/marketplace/listing/counter");
    expect(marketplaceAuthorPath("wolfy-master")).toBe("/marketplace/author/wolfy-master");
    expect(MODULES_MODULE_ROUTE).toBe(`${MODULES_PATH}/:moduleId`);
    expect(installedModulePath("woofx3_obs")).toBe("/stream/modules/woofx3_obs");
  });

  test("encodes an id so a slug with unusual characters still resolves", () => {
    // Listing ids are slugs, but the catalog is a separate service and an id
    // is also what a user can type into the address bar.
    expect(marketplaceListingPath("a b")).toBe("/marketplace/listing/a%20b");
    expect(marketplaceAuthorPath("a/b")).toBe("/marketplace/author/a%2Fb");
  });

  test("the all-categories path is the bare storefront", () => {
    // Otherwise "Everything" would leave ?category=all in the URL and the
    // storefront would read itself as filtered.
    expect(marketplaceCategoryPath("all")).toBe(MARKETPLACE_PATH);
    expect(marketplaceCategoryPath("Utilities")).toBe("/marketplace?category=Utilities");
    expect(marketplaceCategoryPath("Audio & Music")).toBe("/marketplace?category=Audio%20%26%20Music");
  });
});

describe("MARKETPLACE_BROWSE_ROUTE", () => {
  test.each(["/marketplace", "/marketplace/listing/counter", "/marketplace/author/wolfy-master"])(
    "matches %s",
    (path) => {
      expect(parse(MARKETPLACE_BROWSE_ROUTE).pattern.test(path)).toBe(true);
    }
  );

  test("leaves a path that only starts the same way alone", () => {
    expect(parse(MARKETPLACE_BROWSE_ROUTE).pattern.test("/marketplaces")).toBe(false);
  });
});

describe("marketplace filter", () => {
  test.each([
    ["nothing narrowing it", { type: null, category: "all", browseAll: false }, "/marketplace"],
    ["a type", { type: "emote", category: "all", browseAll: false }, "/marketplace?type=emote"],
    [
      "a category",
      { type: null, category: "Audio & Music", browseAll: false },
      "/marketplace?category=Audio+%26+Music",
    ],
    ["the whole catalog", { type: null, category: "all", browseAll: true }, "/marketplace?browse=all"],
  ] as const)("round trips %s", (_case, filter, path) => {
    expect(marketplaceFilterPath(filter)).toBe(path);
    expect(parseMarketplaceFilter(path.split("?")[1] ?? "")).toEqual(filter);
  });

  test("a type or category already opens the grid, so browse is dropped", () => {
    expect(marketplaceFilterPath({ type: "emote", category: "all", browseAll: true })).toBe("/marketplace?type=emote");
  });

  test("a type the storefront does not know reads as no type", () => {
    expect(parseMarketplaceFilter("type=hologram").type).toBeNull();
  });
});

describe("legacyModulesRedirect", () => {
  test.each([
    ["the bare path", undefined, "", "/stream/module-settings"],
    [
      "the bare path, keeping an OAuth return's query",
      undefined,
      "?integration=spotify&oauth_code=abc",
      "/stream/module-settings?integration=spotify&oauth_code=abc",
    ],
    ["the installed list", "installed", "", "/stream/module-settings"],
    ["the upload page", "install", "", "/marketplace/upload"],
    ["a module's page", "woofx3_obs", "", "/stream/modules/woofx3_obs"],
    ["a module's page with an encoded id", "a%20b", "", "/stream/modules/a%20b"],
  ])("%s", (_case, rest, search, target) => {
    expect(legacyModulesRedirect(rest, search)).toBe(target);
  });
});

describe("isMarketplaceFront", () => {
  test.each([
    ["the bare storefront", MARKETPLACE_PATH, "", true],
    ["a filter the storefront does not know", MARKETPLACE_PATH, "?type=bogus", true],
    ["a type filter", MARKETPLACE_PATH, "?type=emote", false],
    ["a category filter", MARKETPLACE_PATH, "?category=Media", false],
    ["the whole catalog", MARKETPLACE_PATH, "?browse=all", false],
    ["a listing", marketplaceListingPath("abc"), "", false],
    ["an author", marketplaceAuthorPath("wolfy"), "", false],
    ["the modules tab", MODULES_PATH, "", false],
  ])("%s", (_case, location, search, front) => {
    expect(isMarketplaceFront(location, search)).toBe(front);
  });
});
