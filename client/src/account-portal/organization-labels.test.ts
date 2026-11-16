import { describe, expect, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import type { OrgRole } from "@convex/lib/organization";
import { organizationLabels } from "./organization-labels";

const org = (id: string, name: string, role: OrgRole) => ({ accountId: id as Id<"accounts">, name, role });

function labelsOf(orgs: ReturnType<typeof org>[]): string[] {
  const labels = organizationLabels(orgs);
  return orgs.map((o) => labels.get(o.accountId) ?? "missing");
}

describe("organizationLabels", () => {
  test("unique names stay as they are", () => {
    expect(labelsOf([org("a", "Wolfy Streams", "owner"), org("b", "My woofx3", "member")])).toEqual([
      "Wolfy Streams",
      "My woofx3",
    ]);
  });

  test("the same name is told apart by the viewer's role", () => {
    expect(labelsOf([org("a", "My woofx3", "owner"), org("b", "My woofx3", "member")])).toEqual([
      "My woofx3 (owner)",
      "My woofx3 (member)",
    ]);
  });

  test("the same name and role are told apart by a count", () => {
    expect(
      labelsOf([org("a", "My woofx3", "member"), org("b", "My woofx3", "member"), org("c", "My woofx3", "owner")])
    ).toEqual(["My woofx3 (member) 1", "My woofx3 (member) 2", "My woofx3 (owner)"]);
  });

  test("one organization is never suffixed", () => {
    expect(labelsOf([org("a", "My woofx3", "owner")])).toEqual(["My woofx3"]);
  });
});
