import { describe, expect, test } from "bun:test";
import { isMissingEngineMethodError } from "./engineMethodSupport";

describe("isMissingEngineMethodError", () => {
  test("recognises capnweb's answer for a method the engine never declared", () => {
    expect(isMissingEngineMethodError("'listObsScenes' is not a function.", "listObsScenes")).toBe(true);
  });

  test("a failure inside the method is not a missing method", () => {
    expect(isMissingEngineMethodError("scene manager timed out", "listObsScenes")).toBe(false);
  });

  test("another method's absence says nothing about this one", () => {
    expect(isMissingEngineMethodError("'getScenes' is not a function.", "listObsScenes")).toBe(false);
  });
});
