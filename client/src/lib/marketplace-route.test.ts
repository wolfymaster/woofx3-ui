import { describe, expect, test } from "bun:test";
import { parse } from "regexparam";
import {
  installedModulePath,
  legacyModulesRedirect,
  MARKETPLACE_AUTHOR_ROUTE,
  MARKETPLACE_BROWSE_ROUTE,
  MARKETPLACE_INSTALLED_MODULE_ROUTE,
  MARKETPLACE_INSTALLED_PATH,
  MARKETPLACE_LISTING_ROUTE,
  MARKETPLACE_PATH,
  marketplaceAuthorPath,
  marketplaceCategoryPath,
  marketplaceFilterPath,
  marketplaceListingPath,
  modulesIndexRedirect,
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
    expect(MARKETPLACE_INSTALLED_MODULE_ROUTE).toBe(`${MARKETPLACE_INSTALLED_PATH}/:moduleId`);
    expect(installedModulePath("woofx3_obs")).toBe("/marketplace/installed/woofx3_obs");
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

describe("modulesIndexRedirect", () => {
  test("an integration's OAuth return reaches the installed modules page, code and all", () => {
    // Only the installed modules page can redeem the one-time code or show the error.
    expect(modulesIndexRedirect("integration=spotify&oauth_code=abc")).toBe(
      "/marketplace/installed?integration=spotify&oauth_code=abc"
    );
    expect(modulesIndexRedirect("?integration=spotify&status=error&error=denied")).toBe(
      "/marketplace/installed?integration=spotify&status=error&error=denied"
    );
  });

  test("an old storefront link reaches the marketplace with its filters", () => {
    expect(modulesIndexRedirect("")).toBe(MARKETPLACE_PATH);
    expect(modulesIndexRedirect("category=Media")).toBe(`${MARKETPLACE_PATH}?category=Media`);
  });
});

describe("legacyModulesRedirect", () => {
  test.each([
    ["the upload page", "install", "", "/marketplace/upload"],
    [
      "the installed list, keeping an OAuth return's query",
      "installed",
      "?integration=spotify&oauth_code=abc",
      "/marketplace/installed?integration=spotify&oauth_code=abc",
    ],
    ["a module's page", "woofx3_obs", "", "/marketplace/installed/woofx3_obs"],
    ["a module's page with an encoded id", "a%20b", "", "/marketplace/installed/a%20b"],
  ])("%s", (_case, rest, search, target) => {
    expect(legacyModulesRedirect(rest, search)).toBe(target);
  });
});
