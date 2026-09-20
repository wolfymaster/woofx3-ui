import { describe, expect, test } from "bun:test";
import { type ChatterOption, matchChatters } from "./chatter-match";

function chatter(login: string, displayName = login): ChatterOption {
  return { userId: `id-${login}`, login, displayName };
}

const ROSTER: ChatterOption[] = [
  chatter("wolfymaster", "WolfyMaster"),
  chatter("anastasia", "Anastasia"),
  chatter("bobby", "Bobby"),
  chatter("cannawolf", "CannaWolf"),
  chatter("zed", "Zed"),
];

function logins(result: ChatterOption[]): string[] {
  return result.map((c) => c.login);
}

describe("matchChatters", () => {
  test("matches on a login prefix", () => {
    expect(logins(matchChatters(ROSTER, "wolf"))).toEqual(["wolfymaster", "cannawolf"]);
  });

  test("ranks a prefix match above a substring match", () => {
    const result = logins(matchChatters(ROSTER, "wolf"));
    expect(result.indexOf("wolfymaster")).toBeLessThan(result.indexOf("cannawolf"));
  });

  test("is case insensitive in both directions", () => {
    expect(logins(matchChatters(ROSTER, "WOLFY"))).toEqual(["wolfymaster"]);
    expect(logins(matchChatters([chatter("xyz", "SuperFan")], "superfan"))).toEqual(["xyz"]);
  });

  test("matches a display name whose login differs", () => {
    const roster = [chatter("qrs123", "NightOwl")];
    expect(logins(matchChatters(roster, "night"))).toEqual(["qrs123"]);
  });

  test("strips a leading @, which people type out of habit", () => {
    expect(logins(matchChatters(ROSTER, "@bobby"))).toEqual(["bobby"]);
  });

  test("ignores surrounding whitespace", () => {
    expect(logins(matchChatters(ROSTER, "  bobby  "))).toEqual(["bobby"]);
  });

  test("an empty query shows who is here, alphabetically", () => {
    expect(logins(matchChatters(ROSTER, ""))).toEqual(["anastasia", "bobby", "cannawolf", "wolfymaster", "zed"]);
  });

  test("a whitespace-only query behaves as empty rather than matching nothing", () => {
    expect(logins(matchChatters(ROSTER, "   ")).length).toBe(5);
  });

  test("returns nothing when no one matches", () => {
    expect(matchChatters(ROSTER, "qqqqq")).toEqual([]);
  });

  test("respects the limit", () => {
    expect(matchChatters(ROSTER, "", 2)).toHaveLength(2);
  });

  test("breaks ties alphabetically so the list does not reshuffle", () => {
    const roster = [chatter("zeta"), chatter("alpha"), chatter("mid")];
    expect(logins(matchChatters(roster, ""))).toEqual(["alpha", "mid", "zeta"]);
  });

  test("does not mutate the roster it was given", () => {
    const roster = [chatter("zeta"), chatter("alpha")];
    matchChatters(roster, "");
    expect(logins(roster)).toEqual(["zeta", "alpha"]);
  });

  test("handles an empty roster", () => {
    expect(matchChatters([], "anything")).toEqual([]);
    expect(matchChatters([], "")).toEqual([]);
  });
});
