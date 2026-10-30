import { describe, expect, test } from "bun:test";
import { bareModuleKey } from "./module-key";

describe("bareModuleKey", () => {
  test("drops the version and content hash", () => {
    expect(bareModuleKey("woofx3_twitch:0.1.1:eb5e20f")).toBe("woofx3_twitch");
  });

  test("is undefined for a key that carries nothing", () => {
    expect(bareModuleKey(undefined)).toBeUndefined();
    expect(bareModuleKey("")).toBeUndefined();
  });
});
