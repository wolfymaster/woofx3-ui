import { expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { type DiscardGuard, useDiscardGuard } from "./use-discard-guard";

async function mount(isDirty: boolean): Promise<() => DiscardGuard> {
  let latest: DiscardGuard | null = null;
  function Probe() {
    latest = useDiscardGuard(isDirty);
    return null;
  }
  await act(async () => {
    create(<Probe />);
  });
  return () => latest as DiscardGuard;
}

test("an unchanged layout is left at once", async () => {
  const guard = await mount(false);
  let left = 0;
  await act(async () => guard().leaveTo(() => left++));
  expect(left).toBe(1);
  expect(guard().isAsking).toBe(false);
});

test("a dirty layout asks first, and leaves only once the edits are discarded", async () => {
  const guard = await mount(true);
  let left = 0;
  await act(async () => guard().leaveTo(() => left++));
  expect(left).toBe(0);
  expect(guard().isAsking).toBe(true);

  await act(async () => guard().discard());
  expect(left).toBe(1);
});

test("keeping the edits drops the departure", async () => {
  const guard = await mount(true);
  let left = 0;
  await act(async () => guard().leaveTo(() => left++));
  await act(async () => guard().keepEditing());
  expect(guard().isAsking).toBe(false);
  await act(async () => guard().discard());
  expect(left).toBe(0);
});
