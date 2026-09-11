import { describe, expect, it } from "bun:test";
import { BUILT_IN_GROUP_ORDER, groupLabel, sortGroups } from "./group-display";

const g = (name: string, isBuiltIn = false) => ({ name, isBuiltIn });

describe("sortGroups", () => {
  it("puts built-in groups ahead of custom ones", () => {
    const sorted = sortGroups([g("alpha"), g("moderator", true)]);
    expect(sorted.map((x) => x.name)).toEqual(["moderator", "alpha"]);
  });

  it("orders built-ins by the engine's catalog order, not alphabetically", () => {
    const shuffled = [g("broadcaster", true), g("everyone", true), g("vip", true), g("subscriber", true)];
    expect(sortGroups(shuffled).map((x) => x.name)).toEqual(["everyone", "subscriber", "vip", "broadcaster"]);
  });

  it("sorts custom groups alphabetically, case-insensitively", () => {
    const sorted = sortGroups([g("zeta"), g("Alpha"), g("beta")]);
    expect(sorted.map((x) => x.name)).toEqual(["Alpha", "beta", "zeta"]);
  });

  it("sorts unknown built-ins after known ones rather than dropping them", () => {
    // follower and subscriber tiers land as built-ins the client hasn't been taught about.
    const sorted = sortGroups([g("follower", true), g("moderator", true), g("subscriber_tier2", true)]);
    expect(sorted.map((x) => x.name)).toEqual(["moderator", "follower", "subscriber_tier2"]);
  });

  it("treats a missing isBuiltIn as custom", () => {
    const sorted = sortGroups([{ name: "regulars" }, g("everyone", true)]);
    expect(sorted.map((x) => x.name)).toEqual(["everyone", "regulars"]);
  });

  it("does not mutate its input", () => {
    const input = [g("zeta"), g("everyone", true)];
    sortGroups(input);
    expect(input.map((x) => x.name)).toEqual(["zeta", "everyone"]);
  });

  it("is stable for groups sharing a rank", () => {
    const sorted = sortGroups([g("mods", true), g("mods", true)]);
    expect(sorted).toHaveLength(2);
  });

  it("keeps the catalog order in sync with the engine's seeded list", () => {
    expect(BUILT_IN_GROUP_ORDER).toEqual(["everyone", "subscriber", "vip", "moderator", "broadcaster"]);
  });
});

describe("groupLabel", () => {
  it("leaves custom group names exactly as the operator typed them", () => {
    expect(groupLabel({ name: "OG regulars" })).toBe("OG regulars");
    expect(groupLabel({ name: "vip", isBuiltIn: false })).toBe("vip");
  });

  it("labels the known built-ins, including the acronym", () => {
    expect(groupLabel(g("everyone", true))).toBe("Everyone");
    expect(groupLabel(g("vip", true))).toBe("VIP");
    expect(groupLabel(g("moderator", true))).toBe("Moderator");
    expect(groupLabel(g("follower", true))).toBe("Follower");
  });

  it("reads subscriber tiers as English", () => {
    expect(groupLabel(g("subscriber_tier1", true))).toBe("Subscriber — Tier 1");
    expect(groupLabel(g("subscriber_tier2", true))).toBe("Subscriber — Tier 2");
    expect(groupLabel(g("subscriber-tier3", true))).toBe("Subscriber — Tier 3");
  });

  it("degrades to capitalisation for an unrecognised built-in", () => {
    expect(groupLabel(g("artist", true))).toBe("Artist");
  });
});
