import { describe, expect, it } from "bun:test";
import { ENTITLEMENT_CATALOG, resolveEntitlements } from "./entitlements";
import {
  formatStorageBytes,
  hostedStorageLimits,
  hostedUploadRefusal,
  isByteLimit,
  isOnHostedStorage,
  moduleStorageUsage,
} from "./hostedStorage";

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

describe("isOnHostedStorage", () => {
  it("never applies to an engine someone else hosts", () => {
    expect(isOnHostedStorage(undefined, { provider: "file" })).toBe(false);
    expect(isOnHostedStorage("external", { provider: "file" })).toBe(false);
  });

  it("applies to a managed engine with no storage settings of its own", () => {
    expect(isOnHostedStorage("managed", { provider: "file" })).toBe(true);
  });

  it("applies while any of bucket or credentials still falls back to the provisioned ones", () => {
    expect(isOnHostedStorage("managed", { provider: "s3", accessKey: "***", secretKey: "***" })).toBe(true);
    expect(isOnHostedStorage("managed", { provider: "s3", bucket: "mine", secretKey: "***" })).toBe(true);
    expect(isOnHostedStorage("managed", { provider: "s3", bucket: "mine", accessKey: "***" })).toBe(true);
  });

  it("stops applying once the settings name a bucket and credentials of their own", () => {
    expect(isOnHostedStorage("managed", { provider: "s3", bucket: "mine", accessKey: "***", secretKey: "***" })).toBe(
      false
    );
  });
});

describe("hostedStorageLimits", () => {
  it("defaults to 50 MB in total, 10 MB a file and 500 MB of module storage", () => {
    expect(hostedStorageLimits(resolveEntitlements(null, null, 0, ENTITLEMENT_CATALOG))).toEqual({
      totalBytes: 50 * MiB,
      fileBytes: 10 * MiB,
      moduleStorageBytes: 500 * MiB,
    });
  });

  it("takes the plan's values, null meaning unlimited", () => {
    const plan = {
      key: "pro",
      name: "Pro",
      features: [],
      limits: [
        { key: "storage.hostedAssetBytes", value: 50 * GiB },
        { key: "storage.hostedFileBytes", value: null },
        { key: "storage.moduleStorageBytes", value: GiB },
      ],
    };
    expect(hostedStorageLimits(resolveEntitlements(plan, null, 0, ENTITLEMENT_CATALOG))).toEqual({
      totalBytes: 50 * GiB,
      fileBytes: null,
      moduleStorageBytes: GiB,
    });
  });
});

describe("hostedStorageLimits with an engine override", () => {
  const plan = {
    key: "pro",
    name: "Pro",
    features: [],
    limits: [{ key: "storage.hostedAssetBytes", value: GiB }],
  };

  it("takes the engine's value where it sets one and the account's elsewhere", () => {
    expect(
      hostedStorageLimits(resolveEntitlements(plan, null, 0, ENTITLEMENT_CATALOG), { totalBytes: 200 * MiB })
    ).toEqual({ totalBytes: 200 * MiB, fileBytes: 10 * MiB, moduleStorageBytes: 500 * MiB });
    expect(
      hostedStorageLimits(resolveEntitlements(plan, null, 0, ENTITLEMENT_CATALOG), { moduleStorageBytes: 2 * GiB })
    ).toEqual({ totalBytes: GiB, fileBytes: 10 * MiB, moduleStorageBytes: 2 * GiB });
  });

  it("can make a limit unlimited, or lower it to nothing", () => {
    expect(
      hostedStorageLimits(resolveEntitlements(plan, null, 0, ENTITLEMENT_CATALOG), {
        totalBytes: null,
        fileBytes: 0,
        moduleStorageBytes: null,
      })
    ).toEqual({ totalBytes: null, fileBytes: 0, moduleStorageBytes: null });
  });
});

describe("isByteLimit", () => {
  it("accepts whole bytes and null, nothing else", () => {
    expect([0, 1024, null].every(isByteLimit)).toBe(true);
    expect([-1, 1.5, "1", undefined, Number.NaN].some(isByteLimit)).toBe(false);
  });
});

describe("hostedUploadRefusal", () => {
  const limits = { totalBytes: GiB, fileBytes: 100 * MiB, moduleStorageBytes: 500 * MiB };

  it("allows an upload that fits exactly", () => {
    expect(hostedUploadRefusal(limits, GiB - 100 * MiB, 100 * MiB)).toBeNull();
  });

  it("refuses a file over the per-file limit", () => {
    expect(hostedUploadRefusal(limits, 0, 100 * MiB + 1)).toContain("up to 100 MB each");
  });

  it("refuses an upload that would pass the total, saying what is left", () => {
    const refusal = hostedUploadRefusal(limits, GiB - MiB, 2 * MiB);
    expect(refusal).toContain("1 GB of asset storage");
    expect(refusal).toContain("1 MB left");
  });

  it("says nothing is left when usage already exceeds the limit", () => {
    expect(hostedUploadRefusal(limits, 2 * GiB, 1)).toContain("0 B left");
  });

  it("allows anything when both are unlimited", () => {
    expect(
      hostedUploadRefusal({ totalBytes: null, fileBytes: null, moduleStorageBytes: null }, 10 * GiB, 10 * GiB)
    ).toBeNull();
  });
});

describe("formatStorageBytes", () => {
  it("uses binary units and drops a needless decimal", () => {
    expect(formatStorageBytes(512)).toBe("512 B");
    expect(formatStorageBytes(1536)).toBe("1.5 KB");
    expect(formatStorageBytes(100 * MiB)).toBe("100 MB");
    expect(formatStorageBytes(GiB)).toBe("1 GB");
  });
});

describe("moduleStorageUsage", () => {
  const limits = { totalBytes: GiB, fileBytes: 100 * MiB, moduleStorageBytes: 500 * MiB };

  it("is over only once usage passes the limit", () => {
    expect(moduleStorageUsage(500 * MiB, limits)).toEqual({ usedBytes: 500 * MiB, limitBytes: 500 * MiB, over: false });
    expect(moduleStorageUsage(500 * MiB + 1, limits).over).toBe(true);
  });

  it("is never over an unlimited limit", () => {
    expect(moduleStorageUsage(10 * GiB, { ...limits, moduleStorageBytes: null })).toEqual({
      usedBytes: 10 * GiB,
      limitBytes: null,
      over: false,
    });
  });
});
