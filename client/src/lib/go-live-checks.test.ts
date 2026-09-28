import { describe, expect, test } from "bun:test";
import type { LastGoLive, OverlayFacts, StreamInfoFacts } from "@convex/lib/goLiveFacts";
import {
  applicablePresets,
  type CheckResult,
  engineCheck,
  erroredCheck,
  obsCheck,
  overlaysCheck,
  runningCheck,
  SAME_STREAM_WINDOW_MS,
  STALE_CATEGORY_MS,
  streamInfoCheck,
  streamInfoFromFacts,
  summarizeChecklist,
  twitchCheck,
  workflowsCheck,
} from "./go-live-checks";

const NOW = Date.UTC(2026, 8, 28, 18, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function channel(overrides: Partial<Extract<StreamInfoFacts, { kind: "ok" }>> = {}): StreamInfoFacts {
  return {
    kind: "ok",
    login: "wolfy",
    title: "Building a go live checklist",
    categoryId: "509670",
    categoryName: "Science & Technology",
    tags: ["English", "Programming"],
    ...overrides,
  };
}

function lastGoLive(overrides: Partial<LastGoLive> = {}): LastGoLive {
  return {
    completedAt: NOW - 2 * DAY,
    title: "Yesterday's stream",
    categoryId: "33214",
    categoryName: "Fortnite",
    ...overrides,
  };
}

function overlays(overrides: Partial<OverlayFacts> = {}): OverlayFacts {
  return { hasScene: true, browserSourceKeyCount: 1, featuredKey: "abc", lastLoadedAt: NOW - 60_000, ...overrides };
}

describe("engineCheck", () => {
  test("passes while the transport holds a session", () => {
    expect(engineCheck(true).status).toBe("pass");
  });

  test("fails with a route to engine settings when it does not", () => {
    const check = engineCheck(false);
    expect(check.status).toBe("fail");
    expect(check.fixes).toEqual([{ kind: "route", label: "Open engine settings", href: "/admin/engine" }]);
  });
});

describe("twitchCheck", () => {
  test("fails when Twitch was never linked", () => {
    expect(twitchCheck({ linked: false }).status).toBe("fail");
  });

  test("fails when Twitch refuses the token, naming why", () => {
    const check = twitchCheck({
      linked: true,
      login: "wolfy",
      tokenValid: false,
      tokenProblem: "Twitch no longer accepts the connection",
      missingScopes: [],
    });
    expect(check.status).toBe("fail");
    expect(check.summary).toContain("Twitch no longer accepts the connection");
    expect(check.fixes[0]).toMatchObject({ kind: "route", href: "/admin/integrations" });
  });

  test("warns about a working link that lacks newer permissions, listing them", () => {
    const check = twitchCheck({
      linked: true,
      login: "wolfy",
      tokenValid: true,
      tokenProblem: null,
      missingScopes: ["clips:edit", "moderator:manage:shoutouts"],
    });
    expect(check.status).toBe("warn");
    expect(check.summary).toContain("2 permissions");
    expect(check.details).toEqual(["clips:edit", "moderator:manage:shoutouts"]);
  });

  test("passes a healthy link with every permission", () => {
    const check = twitchCheck({
      linked: true,
      login: "wolfy",
      tokenValid: true,
      tokenProblem: null,
      missingScopes: [],
    });
    expect(check.status).toBe("pass");
    expect(check.summary).toBe("Connected as wolfy");
  });
});

describe("overlaysCheck", () => {
  test("fails without any scene", () => {
    expect(overlaysCheck(overlays({ hasScene: false, browserSourceKeyCount: 0 }), null, NOW).status).toBe("fail");
  });

  test("fails when scenes exist but none has a browser-source URL", () => {
    const check = overlaysCheck(overlays({ browserSourceKeyCount: 0, featuredKey: null }), null, NOW);
    expect(check.status).toBe("fail");
    expect(check.fixes[0]).toMatchObject({ kind: "route", href: "/stream/scenes" });
  });

  test("can only warn that the live connection is unverifiable, offering the URL to copy", () => {
    const check = overlaysCheck(overlays(), "https://site.example/browser-source/abc", NOW);
    expect(check.status).toBe("warn");
    expect(check.fixes[0]).toEqual({
      kind: "copy",
      label: "Copy browser-source URL",
      text: "https://site.example/browser-source/abc",
    });
    expect(check.details[0]).toContain("1m ago");
  });

  test("says so when no browser source has ever loaded a URL", () => {
    const check = overlaysCheck(overlays({ lastLoadedAt: null }), "https://site.example/browser-source/abc", NOW);
    expect(check.details[0]).toContain("No browser source has loaded");
  });
});

describe("obsCheck", () => {
  test("passes when the engine lists OBS scenes", () => {
    expect(obsCheck({ kind: "connected", sceneCount: 3 })).toMatchObject({
      status: "pass",
      summary: "OBS is connected (3 scenes)",
    });
  });

  test("warns while the scene manager has no OBS connection", () => {
    const check = obsCheck({ kind: "disconnected", reason: "OBS websocket refused the connection" });
    expect(check.status).toBe("warn");
    expect(check.details).toEqual(["OBS websocket refused the connection"]);
    expect(check.fixes).toEqual([{ kind: "retry", label: "Check again" }]);
  });

  test("asks for an engine update rather than failing when the engine cannot answer", () => {
    const check = obsCheck({ kind: "engine-update-needed" });
    expect(check.status).toBe("warn");
    expect(check.summary).toContain("Update");
  });
});

describe("streamInfoCheck", () => {
  test("passes a titled, categorised channel with no history to compare against", () => {
    const check = streamInfoCheck(channel(), null, NOW);
    expect(check.status).toBe("pass");
    expect(check.summary).toBe("Building a go live checklist");
    expect(check.fixes[0]).toMatchObject({
      kind: "external",
      href: "https://dashboard.twitch.tv/u/wolfy/stream-manager",
    });
  });

  test("fails when Twitch is not linked", () => {
    expect(streamInfoCheck({ kind: "unlinked" }, null, NOW).status).toBe("fail");
  });

  test("warns about a missing category", () => {
    const check = streamInfoCheck(channel({ categoryId: "", categoryName: "" }), null, NOW);
    expect(check.status).toBe("warn");
    expect(check.summary).toContain("no category");
  });

  test("warns when the title is the one from the last go-live", () => {
    const check = streamInfoCheck(channel({ title: "Yesterday's stream" }), lastGoLive(), NOW);
    expect(check.status).toBe("warn");
    expect(check.summary).toContain("Same title");
  });

  test("warns when the category has not changed in over a week", () => {
    const check = streamInfoCheck(
      channel({ categoryId: "33214" }),
      lastGoLive({ completedAt: NOW - STALE_CATEGORY_MS - DAY }),
      NOW
    );
    expect(check.status).toBe("warn");
    expect(check.summary).toContain("Category unchanged");
  });

  test("a category repeated within the week is fine", () => {
    expect(streamInfoCheck(channel({ categoryId: "33214" }), lastGoLive(), NOW).status).toBe("pass");
  });

  test("a go-live completed moments ago is this stream's own, not a stale one", () => {
    const recent = lastGoLive({ completedAt: NOW - SAME_STREAM_WINDOW_MS + 1, title: "Building a go live checklist" });
    expect(streamInfoCheck(channel(), recent, NOW).status).toBe("pass");
  });

  test("lists every concern after the first, then the current values", () => {
    const check = streamInfoCheck(
      channel({ title: "Yesterday's stream", categoryId: "33214" }),
      lastGoLive({ completedAt: NOW - STALE_CATEGORY_MS - DAY }),
      NOW
    );
    expect(check.summary).toContain("Same title");
    expect(check.details[0]).toContain("Category unchanged");
    expect(check.details).toContain("Tags: English, Programming");
  });
});

describe("stream info presets", () => {
  const current = {
    id: "p-current",
    name: "Today",
    info: {
      title: "Building a go live checklist",
      category: { id: "509670", name: "Science & Technology" },
      tags: ["English", "Programming"],
    },
  };
  const ranked = {
    id: "p-ranked",
    name: "Ranked grind",
    info: { title: "Ranked grind", category: { id: "33214", name: "Fortnite" }, tags: ["English", "Programming"] },
  };

  test("offers every preset that would change the channel, leaving out the one in place", () => {
    const repeated = lastGoLive({ title: "Building a go live checklist" });
    const check = streamInfoCheck(channel(), repeated, NOW, [current, ranked]);
    expect(check.status).toBe("warn");
    expect(check.fixes[0]).toEqual({
      kind: "apply-preset",
      label: "Apply preset",
      presets: [{ id: "p-ranked", name: "Ranked grind", summary: "Changes title and category" }],
    });
    expect(check.fixes[1]).toMatchObject({ kind: "external" });
  });

  test("offers nothing when no preset would change anything", () => {
    const check = streamInfoCheck(channel(), null, NOW, [current]);
    expect(check.fixes.map((fix) => fix.kind)).toEqual(["external"]);
  });

  test("reads the checked channel in the shape presets are compared against", () => {
    expect(streamInfoFromFacts({ ...(channel() as Extract<StreamInfoFacts, { kind: "ok" }>), categoryId: "" })).toEqual(
      { title: "Building a go live checklist", category: null, tags: ["English", "Programming"] }
    );
    expect(applicablePresets(current.info, [current, ranked]).map((choice) => choice.id)).toEqual(["p-ranked"]);
  });
});

describe("workflowsCheck", () => {
  test("warns with starter packs and workflows when nothing is on", () => {
    const check = workflowsCheck({ any: true, enabled: 0, enabledCapped: false });
    expect(check.status).toBe("warn");
    expect(check.fixes.map((fix) => (fix.kind === "route" ? fix.href : ""))).toEqual([
      "/stream/starter-packs",
      "/stream/workflows",
    ]);
  });

  test("passes with at least one enabled workflow", () => {
    expect(workflowsCheck({ any: true, enabled: 1, enabledCapped: false })).toMatchObject({
      status: "pass",
      summary: "1 workflow is turned on",
    });
  });
});

test("workflowsCheck says when the enabled count hit its cap", () => {
  expect(workflowsCheck({ any: true, enabled: 20, enabledCapped: true }).summary).toBe("20+ workflows are turned on");
});

describe("summarizeChecklist", () => {
  const pass = engineCheck(true);
  const warn = workflowsCheck({ any: false, enabled: 0, enabledCapped: false });
  const fail = twitchCheck({ linked: false });

  test("the worst status wins", () => {
    expect(summarizeChecklist([pass, warn], []).overall).toBe("warn");
    expect(summarizeChecklist([pass, warn, fail], []).overall).toBe("fail");
    expect(summarizeChecklist([pass], []).overall).toBe("pass");
  });

  test("a running check holds the verdict until it lands", () => {
    expect(summarizeChecklist([fail, runningCheck("obs")], []).overall).toBe("running");
  });

  test("a dismissed check never affects the verdict", () => {
    const summary = summarizeChecklist([pass, fail], ["twitch"]);
    expect(summary.overall).toBe("pass");
    expect(summary.dismissed.map((check) => check.id)).toEqual(["twitch"]);
    expect(summary.counts.fail).toBe(0);
  });

  test("everything dismissed reads as clear", () => {
    expect(summarizeChecklist([fail], ["twitch"]).overall).toBe("pass");
  });

  test("keeps checklist order whatever order results arrive in", () => {
    const results: CheckResult[] = [warn, erroredCheck("obs", "timeout"), fail, pass];
    expect(summarizeChecklist(results, []).active.map((check) => check.id)).toEqual([
      "engine",
      "twitch",
      "obs",
      "workflows",
    ]);
  });

  test("an errored check is a warning with a retry, not a failure", () => {
    const check = erroredCheck("stream-info", "Twitch timed out");
    expect(check.status).toBe("warn");
    expect(check.fixes).toEqual([{ kind: "retry", label: "Check again" }]);
  });
});
