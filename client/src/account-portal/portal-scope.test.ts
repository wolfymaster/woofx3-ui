import { describe, expect, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import type { MyOrganization } from "@convex/organizations";
import { PERSONAL_SCOPE, resolveScope } from "./portal-scope";

const id = (value: string) => value as Id<"accounts">;
const org = (accountId: string, role: "owner" | "admin" | "member") =>
  ({ accountId: id(accountId), role }) as MyOrganization;

const ORGS = [org("a", "member"), org("b", "owner"), org("c", "admin")];

describe("resolveScope", () => {
  test("a person with no organization is personal", () => {
    expect(resolveScope([], null, undefined)).toEqual(PERSONAL_SCOPE);
  });

  test("with no pick, the organization of the engine they were in wins", () => {
    expect(resolveScope(ORGS, null, id("c"))).toEqual({ kind: "organization", accountId: id("c") });
  });

  test("with no pick and no engine, one they own wins, else the first", () => {
    expect(resolveScope(ORGS, null, undefined)).toEqual({ kind: "organization", accountId: id("b") });
    expect(resolveScope([org("a", "member"), org("c", "admin")], null, undefined)).toEqual({
      kind: "organization",
      accountId: id("a"),
    });
  });

  test("a pick of personal stays personal even with organizations", () => {
    expect(resolveScope(ORGS, PERSONAL_SCOPE, id("c"))).toEqual(PERSONAL_SCOPE);
  });

  test("a picked organization wins over the engine's", () => {
    expect(resolveScope(ORGS, { kind: "organization", accountId: id("a") }, id("c"))).toEqual({
      kind: "organization",
      accountId: id("a"),
    });
  });

  test("a pick of an organization that is gone falls back", () => {
    expect(resolveScope(ORGS, { kind: "organization", accountId: id("zzz") }, undefined)).toEqual({
      kind: "organization",
      accountId: id("b"),
    });
  });
});
