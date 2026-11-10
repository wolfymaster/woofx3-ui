import { describe, expect, test } from "bun:test";
import { slugFormatError } from "@shared/engine-slug";
import {
  ENGINE_REQUEST_GRACE_MS,
  engineBuildStalled,
  type FirstRunNames,
  linkedNames,
  PLACEHOLDER_NAME,
  REQUEST_IN_FLIGHT_MS,
  slugCandidates,
} from "./firstRun";

/** The first candidate a maintenance API holding `refused` would accept, the way provisioning walks them. */
function firstAccepted(login: string, refused: readonly string[]): string | null {
  return slugCandidates(login).find((slug) => !refused.includes(slug)) ?? null;
}

describe("slugCandidates", () => {
  test("offers the login, the suffixes, then the prefix, in order", () => {
    expect(slugCandidates("WolfyMaster")).toEqual([
      "wolfymaster",
      "wolfymaster-tv",
      "wolfymaster-live",
      "wolfymaster-2",
      "wolfymaster-3",
      "wolfymaster-4",
      "wolfymaster-5",
      "tv-wolfymaster",
    ]);
  });

  test.each([
    { name: "underscores become hyphens", login: "wolfy_master", first: "wolfy-master" },
    { name: "a run of underscores becomes one hyphen", login: "wolfy__master", first: "wolfy-master" },
    { name: "edge underscores are trimmed", login: "_wolfy_", first: "wolfy" },
    { name: "a three-character login is enough", login: "abc", first: "abc" },
  ])("$name", ({ login, first }) => {
    expect(slugCandidates(login)[0]).toBe(first);
  });

  test.each([
    { name: "only underscores", login: "____" },
    { name: "too short once trimmed", login: "a_" },
    { name: "no login known", login: null },
  ])("offers nothing for $name", ({ login }) => {
    expect(slugCandidates(login)).toEqual([]);
  });

  test.each([
    { name: "the longest Twitch login", login: "a".repeat(25) },
    { name: "longer than the limit", login: "a".repeat(40) },
    { name: "a hyphen left at the cut", login: `${"a".repeat(24)}_${"b".repeat(10)}` },
    { name: "a hyphen left at the cut of a prefixed name", login: `${"a".repeat(26)}_bbb` },
  ])("every candidate is a valid slug for $name", ({ login }) => {
    const candidates = slugCandidates(login);
    expect(candidates).toHaveLength(8);
    expect(new Set(candidates).size).toBe(8);
    for (const candidate of candidates) {
      expect(candidate.length).toBeLessThanOrEqual(30);
      expect(slugFormatError(candidate)).toBeNull();
    }
  });

  test.each([
    { name: "free", refused: [], accepted: "streamer" },
    { name: "the login is taken", refused: ["streamer"], accepted: "streamer-tv" },
    {
      name: "every suffix is taken",
      refused: ["-tv", "-live", "-2", "-3", "-4", "-5", ""].map((suffix) => `streamer${suffix}`),
      accepted: "tv-streamer",
    },
    {
      name: "a reserved prefix covers every suffixed name",
      refused: slugCandidates("streamer").slice(0, 7),
      accepted: "tv-streamer",
    },
    { name: "all are taken", refused: slugCandidates("streamer"), accepted: null },
  ])("collisions: $name", ({ refused, accepted }) => {
    expect(firstAccepted("streamer", refused)).toBe(accepted);
  });

  test("a reserved login takes the next candidate", () => {
    expect(firstAccepted("admin", ["admin"])).toBe("admin-tv");
  });
});

describe("linkedNames", () => {
  const placeholders: FirstRunNames = { account: PLACEHOLDER_NAME, instance: PLACEHOLDER_NAME, user: undefined };

  test.each<{ name: string; current: FirstRunNames; display: string; expected: Partial<FirstRunNames> }>([
    {
      name: "renames everything still on the placeholder",
      current: placeholders,
      display: "Wolfy",
      expected: { account: "Wolfy", instance: "Wolfy's Engine", user: "Wolfy" },
    },
    {
      name: "leaves an edited account alone",
      current: { ...placeholders, account: "Studio" },
      display: "Wolfy",
      expected: { instance: "Wolfy's Engine", user: "Wolfy" },
    },
    {
      name: "leaves an edited instance alone",
      current: { ...placeholders, instance: "Main rig" },
      display: "Wolfy",
      expected: { account: "Wolfy", user: "Wolfy" },
    },
    {
      name: "leaves a user's name alone",
      current: { ...placeholders, user: "Jane" },
      display: "Wolfy",
      expected: { account: "Wolfy", instance: "Wolfy's Engine" },
    },
    {
      name: "fills a blank user name",
      current: { account: "Studio", instance: "Main rig", user: "  " },
      display: "Wolfy",
      expected: { user: "Wolfy" },
    },
    {
      name: "does nothing on a later reconnect",
      current: { account: "Wolfy", instance: "Wolfy's Engine", user: "Wolfy" },
      display: "Renamed",
      expected: {},
    },
    {
      name: "keeps a non-Latin display name",
      current: placeholders,
      display: "狼",
      expected: { account: "狼", instance: "狼's Engine", user: "狼" },
    },
    { name: "ignores a blank display name", current: placeholders, display: "  ", expected: {} },
  ])("$name", ({ current, display, expected }) => {
    expect(linkedNames(current, display)).toEqual(expected);
  });
});

describe("engineBuildStalled", () => {
  const NOW = 10_000_000;
  const facts = { provisioning: null, managedEngine: true, completedAt: NOW, now: NOW };

  test.each([
    { name: "a failed row", over: { provisioning: { status: "failed", updatedAt: NOW } }, stalled: true },
    { name: "a fresh requested row", over: { provisioning: { status: "requested", updatedAt: NOW } }, stalled: false },
    {
      name: "a requested row past the in-flight limit",
      over: { provisioning: { status: "requested", updatedAt: NOW - REQUEST_IN_FLIGHT_MS } },
      stalled: true,
    },
    {
      name: "an old row being built",
      over: { provisioning: { status: "provisioning", updatedAt: 0 } },
      stalled: false,
    },
    { name: "no row just after setup finished", over: {}, stalled: false },
    { name: "no row past the grace period", over: { completedAt: NOW - ENGINE_REQUEST_GRACE_MS }, stalled: true },
    { name: "no row and setup never finished", over: { completedAt: null }, stalled: true },
    { name: "no row on an engine the user runs", over: { managedEngine: false }, stalled: true },
  ])("$name", ({ over, stalled }) => {
    expect(engineBuildStalled({ ...facts, ...over })).toBe(stalled);
  });
});
