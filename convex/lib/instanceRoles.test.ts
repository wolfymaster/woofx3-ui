import { describe, expect, test } from "bun:test";
import { roleSatisfies } from "./instanceRoles";

describe("roleSatisfies", () => {
  test("a non-member satisfies nothing", () => {
    expect(roleSatisfies(null, "member")).toBe(false);
    expect(roleSatisfies(undefined, "member")).toBe(false);
  });

  test("every role satisfies member", () => {
    expect(roleSatisfies("member", "member")).toBe(true);
    expect(roleSatisfies("admin", "member")).toBe(true);
    expect(roleSatisfies("owner", "member")).toBe(true);
  });

  test("admin needs admin or owner", () => {
    expect(roleSatisfies("member", "admin")).toBe(false);
    expect(roleSatisfies("admin", "admin")).toBe(true);
    expect(roleSatisfies("owner", "admin")).toBe(true);
  });

  test("owner needs owner", () => {
    expect(roleSatisfies("admin", "owner")).toBe(false);
    expect(roleSatisfies("owner", "owner")).toBe(true);
  });
});
