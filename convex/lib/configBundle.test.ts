import { describe, expect, it } from "bun:test";
import { chunkText, configBackupAccess, utf8ByteLength } from "./configBundle";

describe("chunkText", () => {
  it("round-trips text split into chunks of at most the given size", () => {
    const text = "abcdefghij".repeat(7);
    const chunks = chunkText(text, 16);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 16)).toBe(true);
    expect(chunks).toHaveLength(5);
  });

  it("never splits a surrogate pair", () => {
    const text = "ab\u{1F415}cd";
    const chunks = chunkText(text, 3);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.isWellFormed()).toBe(true);
    }
  });

  it("returns no chunks for empty text", () => {
    expect(chunkText("", 4)).toEqual([]);
  });

  it("refuses a chunk size that cannot hold a surrogate pair", () => {
    expect(() => chunkText("abc", 1)).toThrow();
  });

  it("keeps a default-size chunk under a megabyte of UTF-8", () => {
    const [first] = chunkText("€".repeat(300 * 1024));
    expect(utf8ByteLength(first)).toBeLessThan(1_000_000);
  });
});

describe("configBackupAccess", () => {
  it("lets members export without usernames and never import", () => {
    expect(configBackupAccess("member")).toEqual({ canExport: true, canExportMembers: false, canImport: false });
  });

  it("gives owners and admins everything", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(configBackupAccess(role)).toEqual({ canExport: true, canExportMembers: true, canImport: true });
    }
  });

  it("gives non-members nothing", () => {
    expect(configBackupAccess(null)).toEqual({ canExport: false, canExportMembers: false, canImport: false });
  });
});
