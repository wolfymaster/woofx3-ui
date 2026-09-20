import { describe, expect, test } from "bun:test";
import { engineHostname, slugFormatError, suggestSlug } from "@/lib/engine-slug";

describe("suggestSlug", () => {
  test("turns a display name into something usable", () => {
    expect(suggestSlug("WolfyMaster")).toBe("wolfymaster");
    expect(suggestSlug("My Stream Studio")).toBe("my-stream-studio");
    expect(suggestSlug("wolfy_master")).toBe("wolfy-master");
  });

  test("collapses runs and trims the ends, which the format forbids", () => {
    expect(suggestSlug("  Wolfy   Master!!  ")).toBe("wolfy-master");
    expect(suggestSlug("-wolfy-")).toBe("wolfy");
  });

  test("offers nothing rather than something invalid", () => {
    // Nothing survives, and two characters is below the minimum length.
    expect(suggestSlug("!!!")).toBe("");
    expect(suggestSlug("ab")).toBe("");
    expect(suggestSlug("日本語")).toBe("");
  });

  test("keeps a long name inside the length limit, without a trailing hyphen", () => {
    const slug = suggestSlug(`${"a".repeat(28)} bcdefg`);
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith("-")).toBe(false);
    expect(slugFormatError(slug)).toBeNull();
  });
});

describe("slugFormatError", () => {
  test("says nothing about an empty field or a well-formed slug", () => {
    expect(slugFormatError("")).toBeNull();
    expect(slugFormatError("wolfymaster")).toBeNull();
    expect(slugFormatError("wolfy-master-3")).toBeNull();
    expect(slugFormatError("a1b")).toBeNull();
  });

  // Mirrors validateSlug in the maintenance API; the server still has the
  // final word on reserved words and on what is already taken.
  test("rejects what the maintenance API's format rules reject", () => {
    expect(slugFormatError("ab")).not.toBeNull();
    expect(slugFormatError("a".repeat(31))).not.toBeNull();
    expect(slugFormatError("-wolfy")).not.toBeNull();
    expect(slugFormatError("wolfy-")).not.toBeNull();
    expect(slugFormatError("wolfy--master")).not.toBeNull();
    expect(slugFormatError("Wolfy")).not.toBeNull();
    expect(slugFormatError("wolfy master")).not.toBeNull();
    expect(slugFormatError("wolfy.master")).not.toBeNull();
  });
});

describe("engineHostname", () => {
  test("names the address the engine will answer on", () => {
    expect(engineHostname("wolfymaster")).toBe("wolfymaster.on.woofx3.tv");
  });
});
