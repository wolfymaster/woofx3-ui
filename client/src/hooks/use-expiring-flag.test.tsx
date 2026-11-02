import { expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { useExpiringFlag } from "./use-expiring-flag";

test("a raised flag clears itself once its time is up", async () => {
  let latest: ReturnType<typeof useExpiringFlag> = [false, () => undefined];
  function Probe() {
    latest = useExpiringFlag(5);
    return null;
  }
  await act(async () => {
    create(<Probe />);
  });
  await act(async () => {
    latest[1]();
  });
  expect(latest[0]).toBe(true);

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(latest[0]).toBe(false);
});
