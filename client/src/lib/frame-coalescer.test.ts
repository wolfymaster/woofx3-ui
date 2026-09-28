import { describe, expect, it } from "bun:test";
import { createFrameCoalescer, type FrameScheduler } from "./frame-coalescer";

function manualScheduler() {
  let nextHandle = 1;
  const queued = new Map<number, () => void>();
  const scheduler: FrameScheduler = {
    request(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      queued.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      queued.delete(handle);
    },
  };
  const runFrame = () => {
    const callbacks = [...queued.values()];
    queued.clear();
    for (const callback of callbacks) {
      callback();
    }
  };
  return { scheduler, runFrame, pendingFrames: () => queued.size };
}

describe("createFrameCoalescer", () => {
  it("delivers only the latest value pushed within a frame", () => {
    const { scheduler, runFrame, pendingFrames } = manualScheduler();
    const delivered: number[] = [];
    const coalescer = createFrameCoalescer<number>((value) => delivered.push(value), scheduler);
    coalescer.push(1);
    coalescer.push(2);
    coalescer.push(3);
    expect(pendingFrames()).toBe(1);
    expect(delivered).toEqual([]);
    runFrame();
    expect(delivered).toEqual([3]);
  });

  it("delivers once per frame across frames", () => {
    const { scheduler, runFrame } = manualScheduler();
    const delivered: number[] = [];
    const coalescer = createFrameCoalescer<number>((value) => delivered.push(value), scheduler);
    coalescer.push(1);
    runFrame();
    coalescer.push(2);
    coalescer.push(3);
    runFrame();
    runFrame();
    expect(delivered).toEqual([1, 3]);
  });

  it("flush delivers now and leaves no frame behind", () => {
    const { scheduler, runFrame, pendingFrames } = manualScheduler();
    const delivered: number[] = [];
    const coalescer = createFrameCoalescer<number>((value) => delivered.push(value), scheduler);
    coalescer.push(7);
    coalescer.flush();
    expect(delivered).toEqual([7]);
    expect(pendingFrames()).toBe(0);
    runFrame();
    expect(delivered).toEqual([7]);
  });

  it("flush with nothing pending delivers nothing", () => {
    const { scheduler } = manualScheduler();
    const delivered: number[] = [];
    const coalescer = createFrameCoalescer<number>((value) => delivered.push(value), scheduler);
    coalescer.flush();
    expect(delivered).toEqual([]);
  });

  it("cancel drops the pending value", () => {
    const { scheduler, runFrame, pendingFrames } = manualScheduler();
    const delivered: number[] = [];
    const coalescer = createFrameCoalescer<number>((value) => delivered.push(value), scheduler);
    coalescer.push(1);
    coalescer.cancel();
    expect(pendingFrames()).toBe(0);
    runFrame();
    expect(delivered).toEqual([]);
  });
});
