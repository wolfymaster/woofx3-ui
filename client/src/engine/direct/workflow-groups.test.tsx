import { afterEach, describe, expect, test } from "bun:test";
import { EngineEventType, makeCallbackEnvelope } from "@woofx3/api";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";
import { directWorkflowsGateway } from "./workflows";

// Alert groups through the direct gateway, against the fake engine over real capnweb.

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

const holiday = { id: "g-1", name: "Holiday", description: "", enabled: false, memberIds: ["w-1"] };

describe("alert groups", () => {
  test("are read from the engine and read again on a group event", async () => {
    const { runtime, state, engine } = await connected();
    state.workflowGroups = [holiday];
    const read = renderDirect(() => directWorkflowsGateway(runtime).useGroups());
    const listed = await read.until((value) => value?.length === 1, "the groups");
    expect(listed?.[0]).toEqual({
      engineGroupId: "g-1",
      name: "Holiday",
      description: "",
      enabled: false,
      memberIds: ["w-1"],
    });

    state.workflowGroups = [{ ...holiday, enabled: true }];
    await engine.pushEvent(
      makeCallbackEnvelope(
        { type: EngineEventType.WORKFLOW_GROUP_UPDATED, group: { ...holiday, enabled: true } },
        "engine",
        "e-1"
      )
    );
    await read.until((value) => value?.[0]?.enabled === true, "the switched group");
    read.unmount();
  });

  test("a switch and a new member go out on the session and resolve with the stored group", async () => {
    const { runtime, state } = await connected();
    state.workflowGroups = [holiday];
    const gateway = directWorkflowsGateway(runtime);
    const setEnabled = renderDirect(() => gateway.useSetGroupEnabledRequest()).current();
    const addMembers = renderDirect(() => gateway.useAddGroupMembersRequest()).current();

    expect((await setEnabled("g-1", true)).enabled).toBe(true);
    expect((await addMembers("g-1", ["w-2"])).memberIds).toEqual(["w-1", "w-2"]);
    expect(state.callsOf("setWorkflowGroupEnabled")).toEqual([["g-1", true]]);
    expect(state.callsOf("addWorkflowGroupMembers")).toEqual([["g-1", ["w-2"]]]);
  });

  test("a new group resolves with the engine's id", async () => {
    const { runtime } = await connected();
    const create = renderDirect(() => directWorkflowsGateway(runtime).useCreateGroupRequest()).current();
    expect(await create({ name: "Sponsor", description: "" })).toMatchObject({
      engineGroupId: "group-1",
      enabled: false,
    });
  });
});
