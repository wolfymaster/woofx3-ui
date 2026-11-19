import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ChatCommandsLink } from "./chat-commands-link";

async function render(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <Router hook={memoryLocation({ path: "/stream/alerts" }).hook}>
        <ChatCommandsLink />
      </Router>
    );
  });
  if (!renderer) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

describe("ChatCommandsLink", () => {
  test("points to the Commands screen without listing commands as triggers", async () => {
    const renderer = await render();
    const links = renderer.root.findAll((node) => node.type === "a");
    expect(links).toHaveLength(1);
    expect(links[0].props.href).toBe("/stream/commands");
    const view = JSON.stringify(renderer.toJSON());
    expect(view).not.toContain("Someone uses");
    expect(view).not.toContain("chat-command-triggers");
  });
});
