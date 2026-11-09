import { describe, expect, test } from "bun:test";
import type { MyOrganization } from "@convex/organizations";
import { startsTrial } from "./start-trial";

type Org = Pick<MyOrganization, "role" | "engines">;

const ENGINE = { instanceId: "i", name: "Main", hosting: "managed" } as unknown as MyOrganization["engines"][number];
const OWNER_WITH_ENGINE: Org = { role: "owner", engines: [ENGINE] };
const OWNER_WITHOUT_ENGINE: Org = { role: "owner", engines: [] };
const MEMBER_ELSEWHERE: Org = { role: "member", engines: [ENGINE] };

describe("startsTrial", () => {
  test.each<[string, string, Org[], boolean]>([
    ["no organization yet", "?start=trial", [], true],
    ["an owner without an engine", "?start=trial", [OWNER_WITHOUT_ENGINE], true],
    ["a member of someone else's organization", "start=trial", [MEMBER_ELSEWHERE], true],
    ["an owner who already has an engine", "?start=trial", [OWNER_WITH_ENGINE, MEMBER_ELSEWHERE], false],
    ["no start parameter", "", [], false],
    ["another start value", "?start=pro", [], false],
  ])("%s", (_case, search, organizations, expected) => {
    expect(startsTrial(search, organizations)).toBe(expected);
  });
});
