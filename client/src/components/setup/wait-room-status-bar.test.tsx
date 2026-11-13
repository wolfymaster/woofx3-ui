import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { WaitRoomStatusBar } from "@/components/setup/wait-room-status-bar";
import { type EngineBuild, engineBuildPhases } from "@/lib/engine-build";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BUILD: EngineBuild = {
  stage: "building",
  message: "Building your overlay",
  detail: "Setting up where your scenes, alerts and history live.",
  percent: 50,
  phases: engineBuildPhases("provisioning", [
    { label: "Start container", status: "succeeded" },
    { label: "Create database", status: "running" },
    { label: "Install alert modules", status: "todo" },
    { label: "Register engine", status: "todo" },
  ]),
  elapsedMinutes: 2,
  slow: false,
  note: null,
};

async function render(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<WaitRoomStatusBar build={BUILD} />);
  });
  if (renderer === undefined) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

function textOfNode(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : textOfNode(child))).join("");
}

function textOf(renderer: ReactTestRenderer, id: string): string {
  const node = renderer.root.findAll((candidate) => candidate.props["data-testid"] === id)[0];
  if (node === undefined) {
    throw new Error(`textOf: no node with test id ${id}`);
  }
  return textOfNode(node);
}

describe("WaitRoomStatusBar", () => {
  test("shows the engine starting, the friendly phase and the build's percent", async () => {
    const renderer = await render();

    expect(textOf(renderer, "wait-room-engine-state")).toBe("Starting");
    expect(textOf(renderer, "wait-room-phase")).toBe("Making a home for your alerts");
    expect(textOf(renderer, "wait-room-percent")).toBe("50%");
  });

  test("keeps the dashboard's offline and uptime segments", async () => {
    const renderer = await render();

    expect(textOf(renderer, "wait-room-live-state")).toBe("Offline");
    expect(textOf(renderer, "wait-room-uptime")).toBe("00:00:00");
  });
});
