import { describe, expect, test } from "bun:test";
import {
  installedListing,
  installedVersionsByListing,
  laterEditionInstalled,
  listingManifestId,
  marketplaceInstallKey,
  moduleInstalled,
  resolveProvenance,
} from "./marketplaceInstallIdentity";

const SHA = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

describe("install keys", () => {
  test("a first edition keeps the key it always had: its listing id is its manifest id", () => {
    const edition1 = { id: "cozy", moduleKey: "cozy" };
    expect(marketplaceInstallKey(listingManifestId(edition1), "1.4.2", SHA)).toBe("cozy:1.4.2:abcdef0");
    // The key every install sent before editions, `{listing id}:{version}:{sha7}`.
    expect(marketplaceInstallKey(listingManifestId(edition1), "1.4.2", SHA)).toBe(
      `${edition1.id}:1.4.2:${SHA.slice(0, 7)}`
    );
  });

  test("a later edition installs under its manifest id, which barkloader computes from the archive", () => {
    const edition2 = { id: "cozy-v2", moduleKey: "cozy" };
    expect(listingManifestId(edition2)).toBe("cozy");
    expect(marketplaceInstallKey(listingManifestId(edition2), "2.0.0", SHA)).toBe("cozy:2.0.0:abcdef0");
  });

  test("a marketplace that predates editions sends no moduleKey; its listing id is the manifest id", () => {
    expect(listingManifestId({ id: "cozy" })).toBe("cozy");
    expect(listingManifestId({ id: "cozy", moduleKey: " " })).toBe("cozy");
  });
});

describe("installedListing", () => {
  test("provenance names the listing and edition", () => {
    expect(
      installedListing({ moduleKey: "cozy:2.0.0:abcdef0", marketplaceListingId: "cozy-v2", marketplaceEdition: 2 })
    ).toEqual({ listingId: "cozy-v2", version: "2.0.0", edition: 2, manifestId: "cozy", source: "provenance" });
  });

  test("without provenance the key's manifest id is the listing, which held for every install before editions", () => {
    expect(installedListing({ moduleKey: "cozy:1.4.2:abcdef0" })).toEqual({
      listingId: "cozy",
      version: "1.4.2",
      manifestId: "cozy",
      source: "moduleKey",
    });
  });

  test("a row with neither a key nor provenance is no listing", () => {
    expect(installedListing({})).toBeUndefined();
    expect(installedListing({ moduleKey: "" })).toBeUndefined();
  });

  test("installed versions are keyed by listing, so editions sharing a manifest id stay apart", () => {
    const versions = installedVersionsByListing([
      { moduleKey: "cozy:2.0.0:abcdef0", marketplaceListingId: "cozy-v2", marketplaceEdition: 2 },
      { moduleKey: "obs:1.0.0:1234567" },
      {},
    ]);
    expect([...versions]).toEqual([
      ["cozy-v2", "2.0.0"],
      ["obs", "1.0.0"],
    ]);
  });
});

describe("laterEditionInstalled", () => {
  const edition1 = { id: "cozy", moduleKey: "cozy", edition: 1 };
  const edition2 = { id: "cozy-v2", moduleKey: "cozy", edition: 2 };
  const edition2Row = { moduleKey: "cozy:2.0.0:abcdef0", marketplaceListingId: "cozy-v2", marketplaceEdition: 2 };
  const edition1Row = { moduleKey: "cozy:1.4.2:abcdef0" };

  test("is true only for an earlier edition than the one installed", () => {
    expect(laterEditionInstalled([edition2Row], edition1)).toBe(true);
    expect(laterEditionInstalled([edition2Row], edition2)).toBe(false);
    expect(laterEditionInstalled([edition1Row], edition2)).toBe(false);
    expect(laterEditionInstalled([edition1Row], edition1)).toBe(false);
  });

  test("ignores other modules", () => {
    expect(laterEditionInstalled([{ ...edition2Row, moduleKey: "other:2.0.0:abcdef0" }], edition1)).toBe(false);
  });
});

describe("moduleInstalled", () => {
  test("any edition satisfies a module named by its manifest id or by the installed listing id", () => {
    const rows = [{ moduleKey: "cozy:2.0.0:abcdef0", marketplaceListingId: "cozy-v2", marketplaceEdition: 2 }];
    expect(moduleInstalled(rows, "cozy")).toBe(true);
    expect(moduleInstalled(rows, "cozy-v2")).toBe(true);
    expect(moduleInstalled(rows, "other")).toBe(false);
  });
});

describe("resolveProvenance", () => {
  const key = "cozy:2.0.0:abcdef0";
  const none = { marketplaceListingId: undefined, marketplaceEdition: undefined };

  test("the engine's report wins", () => {
    expect(
      resolveProvenance({
        moduleKey: key,
        reported: { marketplaceListingId: "cozy-v2", marketplaceEdition: 2 },
        recorded: { marketplaceListingId: "cozy", marketplaceEdition: 1 },
      })
    ).toEqual({ marketplaceListingId: "cozy-v2", marketplaceEdition: 2 });
  });

  test("an engine that reports nothing falls back to what Convex recorded for the key", () => {
    expect(
      resolveProvenance({
        moduleKey: key,
        reported: {},
        recorded: { marketplaceListingId: "cozy-v2", marketplaceEdition: 2 },
      })
    ).toEqual({ marketplaceListingId: "cozy-v2", marketplaceEdition: 2 });
  });

  test("a row keeps its provenance while its key is unchanged", () => {
    const existing = { moduleKey: key, marketplaceListingId: "cozy-v2", marketplaceEdition: 2 };
    expect(resolveProvenance({ moduleKey: key, existing })).toEqual({
      marketplaceListingId: "cozy-v2",
      marketplaceEdition: 2,
    });
  });

  test("a new build nobody recorded clears the row's provenance, leaving the key to say what it is", () => {
    const existing = { moduleKey: "cozy:1.4.2:1234567", marketplaceListingId: "cozy", marketplaceEdition: 1 };
    expect(resolveProvenance({ moduleKey: key, existing, recorded: null })).toEqual(none);
    expect(resolveProvenance({ moduleKey: undefined, existing })).toEqual(none);
  });
});
