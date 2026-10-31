import { afterEach, describe, expect, test } from "bun:test";
import type { UISetting } from "@woofx3/api";
import { directKeys } from "./keys";
import { createDirectHarness, type DirectHarness } from "./testing/direct-harness";
import { removeUISetting, UI_SETTING_NAMESPACES, updateUISetting } from "./ui-settings";

// The local UI settings store against a fake engine over real capnweb:
// conditional writes, conflicts from a writer that lands first, and the
// cached namespace read the store keeps current.

const NAMESPACE = UI_SETTING_NAMESPACES.pageIntros;
const harnesses: DirectHarness[] = [];

async function connected(attempts = 3): Promise<DirectHarness> {
  const harness = createDirectHarness({ uiSettingWriteAttempts: attempts });
  harnesses.push(harness);
  await harness.connect();
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.stop();
  }
});

/** Stores `value` under `key` as another writer would, at the next revision. */
function writeElsewhere(state: DirectHarness["state"], key: string, value: number): void {
  state.uiSettingRevision += 1;
  state.uiSettings[NAMESPACE] = {
    ...(state.uiSettings[NAMESPACE] ?? {}),
    [key]: {
      namespace: NAMESPACE,
      key,
      value,
      revision: state.uiSettingRevision,
      updatedAt: "2026-10-30T10:00:00Z",
      deleted: false,
    },
  };
}

const increment = (current: UISetting | null) => ({
  kind: "write" as const,
  value: (typeof current?.value === "number" ? current.value : 0) + 1,
});

describe("updateUISetting", () => {
  test("creates an absent key only if it is still absent", async () => {
    const { runtime, state } = await connected();
    const stored = await updateUISetting(runtime, NAMESPACE, "count", increment, "test");
    expect(stored?.value).toBe(1);
    expect(state.callsOf("setUISetting")).toEqual([[NAMESPACE, "count", 1, 0]]);
  });

  test("writes against the revision it read", async () => {
    const { runtime, state } = await connected();
    writeElsewhere(state, "count", 5);
    await updateUISetting(runtime, NAMESPACE, "count", increment, "test");
    expect(state.callsOf("setUISetting")).toEqual([[NAMESPACE, "count", 6, 1]]);
  });

  test("a write that lost to another merges onto the winner and tries again", async () => {
    const { runtime, state } = await connected();
    writeElsewhere(state, "count", 5);
    let raced = false;
    state.beforeUISettingWrite = () => {
      if (!raced) {
        raced = true;
        writeElsewhere(state, "count", 10);
      }
    };
    const stored = await updateUISetting(runtime, NAMESPACE, "count", increment, "test");
    expect(stored?.value).toBe(11);
    expect(state.callsOf("setUISetting")).toEqual([
      [NAMESPACE, "count", 6, 1],
      [NAMESPACE, "count", 11, 2],
    ]);
  });

  test("gives up after the configured tries rather than overwrite a change it never saw", async () => {
    const { runtime, state } = await connected(3);
    state.beforeUISettingWrite = () => writeElsewhere(state, "count", 100);
    const error = await updateUISetting(runtime, NAMESPACE, "count", increment, "test.member").catch(
      (thrown: unknown) => thrown
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("test.member");
    expect((error as Error).message).toContain("gave up after 3 tries");
    expect(state.callsOf("setUISetting")).toHaveLength(3);
  });

  test("keeping the value writes nothing", async () => {
    const { runtime, state } = await connected();
    writeElsewhere(state, "count", 5);
    const stored = await updateUISetting(runtime, NAMESPACE, "count", () => ({ kind: "keep" }), "test");
    expect(stored?.value).toBe(5);
    expect(state.callsOf("setUISetting")).toEqual([]);
  });

  test("a deleted key reads as absent and is created again", async () => {
    const { runtime, state } = await connected();
    writeElsewhere(state, "count", 5);
    await removeUISetting(runtime, NAMESPACE, "count", "test");
    const stored = await updateUISetting(runtime, NAMESPACE, "count", increment, "test");
    expect(stored?.value).toBe(1);
    expect(state.callsOf("setUISetting")).toEqual([[NAMESPACE, "count", 1, 0]]);
  });
});

describe("the cached namespace", () => {
  test("a write and a delete show in the cached read before they resolve", async () => {
    const { runtime } = await connected();
    const key = directKeys.uiSettings.namespace(NAMESPACE);
    runtime.queryClient.setQueryData<UISetting[]>(key, []);

    await updateUISetting(runtime, NAMESPACE, "count", increment, "test");
    expect(runtime.queryClient.getQueryData<UISetting[]>(key)?.map((setting) => setting.value)).toEqual([1]);

    await removeUISetting(runtime, NAMESPACE, "count", "test");
    expect(runtime.queryClient.getQueryData<UISetting[]>(key)).toEqual([]);
  });
});
