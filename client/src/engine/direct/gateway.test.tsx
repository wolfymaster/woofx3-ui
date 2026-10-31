import { afterEach, expect, test } from "bun:test";
import { GatewayUnsupportedError } from "@/engine/errors";
import { createDirectEngineGateway } from "./gateway";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";
import { FakeShoutoutQueueHost } from "./testing/FakeShoutoutQueueHost";
import { FakeStreamStartMarkers } from "./testing/FakeStreamStartMarkers";

const harnesses: DirectHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.stop();
  }
});

test("the assembled gateway reads through the runtime it was built around", async () => {
  const harness = createDirectHarness();
  harnesses.push(harness);
  await harness.connect();
  harness.state.commands = [];
  const gateway = createDirectEngineGateway(harness.runtime, {
    streamStartMarkers: new FakeStreamStartMarkers(),
    shoutoutQueue: new FakeShoutoutQueueHost(),
  });
  const commands = renderDirect(() => gateway.commands.useCommands());
  expect(await commands.until((value) => value !== undefined, "the commands")).toEqual([]);
  commands.unmount();
});

test("a namespace with no engine home rejects, naming the member", async () => {
  const harness = createDirectHarness();
  harnesses.push(harness);
  await harness.connect();
  const gateway = createDirectEngineGateway(harness.runtime, {
    streamStartMarkers: new FakeStreamStartMarkers(),
    shoutoutQueue: new FakeShoutoutQueueHost(),
  });
  const start = renderDirect(() => gateway.setupImports.useStartRequest()).current();
  const error = await start("import" as never).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GatewayUnsupportedError);
  expect(String(error)).toContain("setupImports.useStartRequest");
});
