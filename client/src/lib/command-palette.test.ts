import { describe, expect, test } from "bun:test";
import {
  inlineArgument,
  type PaletteEntry,
  parseQuery,
  pushRecent,
  RECENT_HEADING,
  rankEntries,
  scoreEntry,
} from "./command-palette";

const entry = (overrides: Partial<PaletteEntry> & Pick<PaletteEntry, "id" | "title">): PaletteEntry => ({
  kind: "page",
  group: "Go to",
  ...overrides,
});

const workflows = entry({ id: "page:workflows", title: "Workflows", keywords: ["automation"] });
const newWorkflow = entry({ id: "action:new-workflow", title: "New workflow", kind: "action", group: "Actions" });
const deaths = entry({
  id: "item:counter:deaths",
  title: "Deaths",
  kind: "item",
  group: "Counters",
  subtitle: "Counter",
});
const resetDeaths = entry({
  id: "action:counter:deaths:reset",
  title: "Reset",
  kind: "action",
  group: "Counters",
  subtitle: "Deaths",
});
const logs = entry({ id: "page:logs", title: "Logs", subtitle: "Help" });

describe("parseQuery", () => {
  test("reads a scope prefix and strips it", () => {
    expect(parseQuery("> reset")).toEqual({ scope: "action", text: "reset" });
    expect(parseQuery("/logs")).toEqual({ scope: "page", text: "logs" });
    expect(parseQuery("#deaths")).toEqual({ scope: "item", text: "deaths" });
  });

  test("searches everything without a prefix", () => {
    expect(parseQuery("  deaths ")).toEqual({ scope: "all", text: "deaths" });
  });

  // `!` is how chat commands are written, so it must reach the search, not pick a scope.
  test("leaves a chat command's bang in the text", () => {
    expect(parseQuery("!so")).toEqual({ scope: "all", text: "!so" });
  });
});

describe("scoreEntry", () => {
  test("ranks exact over prefix over word start over substring", () => {
    const exact = scoreEntry(entry({ id: "a", title: "Logs" }), "logs");
    const prefix = scoreEntry(entry({ id: "b", title: "Logs archive" }), "logs");
    const wordStart = scoreEntry(entry({ id: "c", title: "Engine logs" }), "logs");
    const substring = scoreEntry(entry({ id: "d", title: "Backlogs" }), "logs");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
  });

  test("finds initials by subsequence", () => {
    expect(scoreEntry(newWorkflow, "nw")).toBeGreaterThan(0);
  });

  test("rejects characters scattered too widely to be meant", () => {
    expect(scoreEntry(entry({ id: "x", title: "Supporters" }), "zq")).toBe(0);
  });

  test("matches keywords below an equal title match", () => {
    const byKeyword = scoreEntry(workflows, "automation");
    const byTitle = scoreEntry(entry({ id: "y", title: "Automation" }), "automation");
    expect(byKeyword).toBeGreaterThan(0);
    expect(byKeyword).toBeLessThan(byTitle);
  });

  test("matches each word of the query anywhere on the entry", () => {
    expect(scoreEntry(resetDeaths, "reset deaths")).toBeGreaterThan(0);
    expect(scoreEntry(resetDeaths, "deaths reset")).toBeGreaterThan(0);
    expect(scoreEntry(resetDeaths, "reset timer")).toBe(0);
  });

  test("ignores case and accents", () => {
    expect(scoreEntry(entry({ id: "z", title: "Café Scene" }), "CAFE")).toBeGreaterThan(0);
  });

  test("adds the entry's boost", () => {
    const plain = scoreEntry(logs, "logs");
    expect(scoreEntry({ ...logs, boost: 50 }, "logs")).toBe(plain + 50);
  });
});

describe("rankEntries", () => {
  const all = [workflows, newWorkflow, deaths, resetDeaths, logs];

  test("orders sections by their best match", () => {
    const sections = rankEntries(all, "deaths");
    expect(sections[0].heading).toBe("Counters");
    expect(sections[0].entries[0].id).toBe(deaths.id);
  });

  test("narrows to a kind by prefix", () => {
    const sections = rankEntries(all, ">work");
    expect(sections.flatMap((s) => s.entries).map((e) => e.id)).toEqual([newWorkflow.id]);
  });

  test("caps each section while searching", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      entry({ id: `item:${i}`, title: `Scene ${i}`, kind: "item", group: "Scenes" })
    );
    const sections = rankEntries(many, "scene", { limitPerGroup: 4 });
    expect(sections[0].entries).toHaveLength(4);
  });

  test("leads with recents on an empty query and does not repeat them", () => {
    const sections = rankEntries(all, "", { recentIds: [logs.id, "gone"] });
    expect(sections[0]).toEqual({ heading: RECENT_HEADING, entries: [logs] });
    const rest = sections.slice(1).flatMap((s) => s.entries);
    expect(rest).not.toContain(logs);
  });

  test("hides the chosen kinds on an empty query, but not when scoped to them", () => {
    const unscoped = rankEntries(all, "", { hideWhenEmpty: ["item"] }).flatMap((s) => s.entries);
    expect(unscoped).not.toContain(deaths);
    const scoped = rankEntries(all, "#", { hideWhenEmpty: ["item"] }).flatMap((s) => s.entries);
    expect(scoped).toContain(deaths);
  });

  test("puts boosted entries first within a section on an empty query", () => {
    const boosted = { ...logs, boost: 10 };
    const sections = rankEntries([workflows, boosted], "");
    expect(sections[0].entries[0]).toBe(boosted);
  });
});

describe("hiddenUntilSearch", () => {
  const nested = { ...resetDeaths, hiddenUntilSearch: true };

  test("is left out of the empty list", () => {
    expect(rankEntries([nested, logs], "").flatMap((s) => s.entries)).toEqual([logs]);
  });

  test("still shows as recent", () => {
    expect(rankEntries([nested], "", { recentIds: [nested.id] })[0].entries).toEqual([nested]);
  });

  test("is found by search", () => {
    expect(rankEntries([nested], "reset deaths")[0].entries).toEqual([nested]);
  });
});

describe("inlineArgument", () => {
  const aliases = ["so", "shout out", "shout"];

  test("reads what follows an alias", () => {
    expect(inlineArgument("so ninja", aliases)).toBe("ninja");
    expect(inlineArgument("SO  Ninja ", aliases)).toBe("Ninja");
  });

  test("prefers the longest alias", () => {
    expect(inlineArgument("shout out ninja", aliases)).toBe("ninja");
  });

  test("needs an argument and a word break", () => {
    expect(inlineArgument("so", aliases)).toBeNull();
    expect(inlineArgument("so ", aliases)).toBeNull();
    expect(inlineArgument("soup", aliases)).toBeNull();
  });
});

describe("pushRecent", () => {
  test("moves a chosen id to the front without duplicating it", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  test("drops the oldest past the cap", () => {
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});
