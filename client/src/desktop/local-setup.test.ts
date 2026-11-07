import { describe, expect, test } from "bun:test";
import { DEFAULT_DASHBOARD_WIDGETS } from "@shared/default-seed";
import type { DefaultSeedStatus, InstalledModule, ModuleId } from "@/engine/types";
import { overlayPageRedirects } from "@/lib/setup-steps";
import {
  localDefaultDashboardWidgets,
  localSetupPending,
  localSetupStep,
  seedHasPending,
  twitchModuleInstalled,
} from "./local-setup";

function installed(moduleKey: string | undefined, status: InstalledModule["status"] = "installed"): InstalledModule {
  return {
    id: "m" as ModuleId,
    name: "m",
    description: "",
    version: "1.0.0",
    tags: [],
    moduleKey,
    status,
    provenance: null,
    manifest: null,
  };
}

const settledSeed: Pick<DefaultSeedStatus, "scene" | "alerts"> = {
  scene: { status: "installed", engineSceneId: "s1" },
  alerts: [{ itemId: "follow", event: "channel.follow", status: "installed" }],
};

describe("twitchModuleInstalled", () => {
  const cases: { name: string; modules: InstalledModule[]; expected: boolean }[] = [
    { name: "installed", modules: [installed("woofx3_twitch:0.16.0:abc1234")], expected: true },
    { name: "still installing", modules: [installed("woofx3_twitch:0.16.0:abc1234", "delivering")], expected: false },
    { name: "a failed install", modules: [installed("woofx3_twitch:0.16.0:abc1234", "failed")], expected: false },
    { name: "another module", modules: [installed("woofx3_obs:1.0.0:abc1234")], expected: false },
    { name: "a name that only starts the same", modules: [installed("woofx3_twitchy:1.0.0:abc")], expected: false },
    { name: "no key yet", modules: [installed(undefined)], expected: false },
    { name: "nothing installed", modules: [], expected: false },
  ];
  for (const { name, modules, expected } of cases) {
    test(name, () => {
      expect(twitchModuleInstalled(modules)).toBe(expected);
    });
  }
});

describe("localSetupStep", () => {
  test("starts on connect", () => {
    expect(localSetupStep(false, false)).toBe("connect");
  });
  test("moves on once the module is installed", () => {
    expect(localSetupStep(true, false)).toBe("overlay");
  });
  test("moves on while the install is still landing", () => {
    expect(localSetupStep(false, true)).toBe("overlay");
  });
});

describe("the setup guard's decision", () => {
  const redirects = (overlayDone: DefaultSeedStatus["overlayDone"], path: string) =>
    overlayPageRedirects(localSetupPending({ overlayDone }), path);

  test("sends a first run to setup", () => {
    expect(redirects(null, "/")).toBe(true);
  });
  test("leaves the alerts page reachable during setup", () => {
    expect(redirects(null, "/stream/alerts")).toBe(false);
  });
  test("lets a finished setup through", () => {
    expect(redirects({ outcome: "finished" }, "/")).toBe(false);
  });
  test("lets a skipped overlay page through", () => {
    expect(redirects({ outcome: "skipped" }, "/")).toBe(false);
  });
});

describe("seedHasPending", () => {
  test("nothing pending once everything is in place", () => {
    expect(seedHasPending(settledSeed)).toBe(false);
  });
  test("a pending scene", () => {
    expect(seedHasPending({ ...settledSeed, scene: { status: "pending" } })).toBe(true);
  });
  test("a pending alert, such as one waiting on the Twitch module's triggers", () => {
    expect(
      seedHasPending({ ...settledSeed, alerts: [{ itemId: "sub", event: "channel.subscribe", status: "pending" }] })
    ).toBe(true);
  });
  test("a failed alert is not retried", () => {
    expect(
      seedHasPending({ ...settledSeed, alerts: [{ itemId: "sub", event: "channel.subscribe", status: "failed" }] })
    ).toBe(false);
  });
});

describe("localDefaultDashboardWidgets", () => {
  test("keeps every default widget the local dashboard shows", () => {
    const all = new Set(DEFAULT_DASHBOARD_WIDGETS.map((widget) => widget.type));
    expect(localDefaultDashboardWidgets(all)).toEqual(DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })));
  });
  test("leaves out pinned messages, which only an account keeps", () => {
    const types = localDefaultDashboardWidgets(new Set(["macro-pad", "events", "shoutout", "announcement"])).map(
      (widget) => widget.type
    );
    expect(types).toEqual(["macro-pad", "events", "shoutout", "announcement"]);
  });
});
