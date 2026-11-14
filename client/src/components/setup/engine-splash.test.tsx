import { describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { EngineSplash } from "@/components/setup/engine-splash";
import { type EngineBuild, engineBuildPhases } from "@/lib/engine-build";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BUILDING: EngineBuild = {
  stage: "building",
  message: "Building your overlay",
  detail: "Finding a server and giving it room to run.",
  percent: 5,
  phases: engineBuildPhases("provisioning", [{ label: "Start container", status: "running" }]),
  elapsedMinutes: 0,
  slow: false,
  note: null,
};

const READY: EngineBuild = { stage: "ready" };

const noop = () => undefined;

async function render(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(element);
  });
  if (renderer === undefined) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

function hasTestId(renderer: ReactTestRenderer, id: string): boolean {
  return renderer.root.findAll((node) => node.props["data-testid"] === id).length > 0;
}

function press(renderer: ReactTestRenderer, id: string): Promise<void> {
  return act(async () => {
    const button = renderer.root.findAll((node) => node.props["data-testid"] === id && node.type === "button")[0];
    if (button === undefined) {
      throw new Error(`press: no button with test id ${id}`);
    }
    button.props.onClick();
  });
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function splash(props: {
  build: EngineBuild;
  onReady?: () => void;
  onBackToOverlay?: () => void;
  autoOpenMs?: number;
}): ReactElement {
  return (
    <EngineSplash
      build={props.build}
      onReady={props.onReady ?? noop}
      onBackToOverlay={props.onBackToOverlay ?? noop}
      autoOpenMs={props.autoOpenMs ?? 50}
    />
  );
}

describe("EngineSplash", () => {
  test("offers a way back to the overlay while the build runs", async () => {
    const back = mock(() => undefined);
    const renderer = await render(splash({ build: BUILDING, onBackToOverlay: back }));

    expect(hasTestId(renderer, "button-splash-back")).toBe(true);
    expect(hasTestId(renderer, "wait-room-status-bar")).toBe(true);
    await press(renderer, "button-splash-back");
    expect(back).toHaveBeenCalledTimes(1);
  });

  test("offers the duck game while the build runs and not after it fails", async () => {
    const building = await render(splash({ build: BUILDING }));
    expect(hasTestId(building, "text-duck-status")).toBe(true);
    expect(hasTestId(building, "text-duck-score")).toBe(true);

    const failed = await render(splash({ build: { stage: "failed", retry: async () => undefined } }));
    expect(hasTestId(failed, "text-duck-status")).toBe(false);
  });

  test("shows the ready card when the build finishes while on screen", async () => {
    const ready = mock(() => undefined);
    const renderer = await render(splash({ build: BUILDING, onReady: ready, autoOpenMs: 50 }));

    await act(async () => {
      renderer.update(splash({ build: READY, onReady: ready, autoOpenMs: 50 }));
    });

    expect(hasTestId(renderer, "text-splash-ready")).toBe(true);
    expect(hasTestId(renderer, "button-splash-back")).toBe(false);
    expect(hasTestId(renderer, "wait-room-status-bar")).toBe(false);
    expect(ready).not.toHaveBeenCalled();

    await press(renderer, "button-splash-open-dashboard");
    expect(ready).toHaveBeenCalledTimes(1);
  });

  test("Stay here cancels the auto-open", async () => {
    const ready = mock(() => undefined);
    const renderer = await render(splash({ build: BUILDING, onReady: ready, autoOpenMs: 10 }));

    await act(async () => {
      renderer.update(splash({ build: READY, onReady: ready, autoOpenMs: 10 }));
    });
    await press(renderer, "button-splash-stay");
    await wait(30);

    expect(ready).not.toHaveBeenCalled();
    expect(hasTestId(renderer, "button-splash-stay")).toBe(false);

    await press(renderer, "button-splash-open-dashboard");
    expect(ready).toHaveBeenCalledTimes(1);
  });

  test("opens by itself when nobody answers the ready card", async () => {
    const ready = mock(() => undefined);
    const renderer = await render(splash({ build: BUILDING, onReady: ready, autoOpenMs: 10 }));

    await act(async () => {
      renderer.update(splash({ build: READY, onReady: ready, autoOpenMs: 10 }));
    });
    await wait(30);

    expect(ready).toHaveBeenCalledTimes(1);
  });

  test("opens at once when it opens on an engine that is already ready", async () => {
    const ready = mock(() => undefined);
    const renderer = await render(splash({ build: READY, onReady: ready }));

    expect(ready).toHaveBeenCalledTimes(1);
    expect(hasTestId(renderer, "text-splash-ready")).toBe(false);
  });
});
