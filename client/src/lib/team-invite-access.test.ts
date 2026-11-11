import { describe, expect, test } from "bun:test";
import { type TeamInviteAccess, teamInviteAccess } from "./team-invite-access";

describe("teamInviteAccess", () => {
  const cases: Array<[string, { canManage: boolean } | null | undefined, TeamInviteAccess]> = [
    ["still loading", undefined, "loading"],
    ["not on the engine", null, "denied"],
    ["a plain member", { canManage: false }, "denied"],
    ["an engine admin", { canManage: true }, "allowed"],
  ];
  test.each(cases)("%s", (_name, team, expected) => {
    expect(teamInviteAccess(team)).toBe(expected);
  });
});
