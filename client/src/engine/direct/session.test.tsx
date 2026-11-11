import { afterEach, describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import { waitFor } from "@/lib/engine-session/testing/wait-for";
import { directSessionGateway } from "./session";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";

// The engine's capabilities through the direct gateway, against the fake engine over real capnweb.

const harnesses: DirectHarness[] = [];

async function connected(): Promise<DirectHarness> {
  const harness = createDirectHarness();
  harnesses.push(harness);
  await harness.connect();
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.stop();
  }
});

describe("engine capabilities", () => {
  test("any number of readers cost the engine one call per session", async () => {
    const { runtime, engine } = await connected();
    const atConnect = engine.capabilityReads;
    const gateway = directSessionGateway(runtime);

    const first = renderDirect(() => gateway.useCapabilities());
    const second = renderDirect(() => gateway.useCapabilities());
    const third = renderDirect(() => gateway.useCapabilities());
    const listed = await first.until((value) => value !== undefined, "the capabilities");
    await second.until((value) => value !== undefined, "the second reader's capabilities");
    await third.until((value) => value !== undefined, "the third reader's capabilities");

    expect(listed).toContain(ENGINE_CAPABILITIES.workflowsGroups);
    expect(engine.capabilityReads - atConnect).toBe(1);
    first.unmount();
    second.unmount();
    third.unmount();
  });

  test("are read again once the session comes back", async () => {
    const { runtime, engine, clock } = await connected();
    const gateway = directSessionGateway(runtime);
    const reader = renderDirect(() => gateway.useCapabilities());
    await reader.until((value) => value !== undefined, "the capabilities");
    const beforeRestart = engine.capabilityReads;

    engine.breakSessions();
    await waitFor(() => runtime.connection.session.state.status === "waiting", "the session to drop");
    clock.advance(runtime.config.session.reconnectMaxMs);
    // The new session's own connect check is one read; the cached answer being read again is another.
    await reader.until(() => engine.capabilityReads - beforeRestart >= 2, "the capabilities read again");
    reader.unmount();
  });
});

describe("the caller's role", () => {
  test("is the owner of the engine they run directly", async () => {
    const { runtime } = await connected();
    const reader = renderDirect(() => directSessionGateway(runtime).useRole());
    expect(await reader.until((value) => value !== undefined, "the role")).toBe("owner");
    reader.unmount();
  });
});
