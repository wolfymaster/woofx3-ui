import { describe, expect, test } from "bun:test";
import type { MyOrganization } from "@convex/organizations";
import { startsTrial } from "./start-trial";

type Org = Pick<MyOrganization, "engines">;

const ENGINE = { instanceId: "i", name: "Main", hosting: "managed" } as unknown as MyOrganization["engines"][number];
const WITH_ENGINE: Org = { engines: [ENGINE] };
const WITHOUT_ENGINE: Org = { engines: [] };

describe("startsTrial", () => {
  test.each<[string, string, Org[], boolean]>([
    ["no organization yet", "?start=trial", [], true],
    ["an owner without an engine", "?start=trial", [WITHOUT_ENGINE], true],
    ["a member invited to an engine in someone else's organization", "start=trial", [WITH_ENGINE], false],
    [
      "an owner without an engine who is on another organization's engine",
      "?start=trial",
      [WITHOUT_ENGINE, WITH_ENGINE],
      false,
    ],
    ["an owner who already has an engine", "?start=trial", [WITH_ENGINE], false],
    ["no start parameter", "", [], false],
    ["another start value", "?start=pro", [], false],
  ])("%s", (_case, search, organizations, expected) => {
    expect(startsTrial(search, organizations)).toBe(expected);
  });
});
