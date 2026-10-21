import { describe, expect, it } from "bun:test";
import { parseStorageLimitsRequest } from "./storageLimitsRequest";

describe("parseStorageLimitsRequest", () => {
  it("keeps amounts, unlimited and inherited fields apart", () => {
    expect(parseStorageLimitsRequest({ totalBytes: 1024, fileBytes: null })).toEqual({
      ok: true,
      value: { totalBytes: 1024, fileBytes: null },
    });
    expect(parseStorageLimitsRequest({ fileBytes: 0 })).toEqual({ ok: true, value: { fileBytes: 0 } });
    expect(parseStorageLimitsRequest({})).toEqual({ ok: true, value: {} });
  });

  it("refuses amounts that are not whole bytes", () => {
    for (const totalBytes of [-1, 1.5, "1024", Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseStorageLimitsRequest({ totalBytes })).toMatchObject({ ok: false });
    }
  });

  it("refuses unknown fields and bodies that are not objects", () => {
    expect(parseStorageLimitsRequest({ totalBytes: 1, hostedAssetBytes: 1 })).toMatchObject({ ok: false });
    expect(parseStorageLimitsRequest(null)).toMatchObject({ ok: false });
    expect(parseStorageLimitsRequest([])).toMatchObject({ ok: false });
  });
});
