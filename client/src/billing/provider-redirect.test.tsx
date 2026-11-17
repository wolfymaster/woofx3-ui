import { afterEach, describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";

import { useProviderRedirect } from "./provider-redirect";

const assigned: string[] = [];
const realWindow = globalThis.window;

function setup() {
  assigned.length = 0;
  (globalThis as { window?: unknown }).window = { location: { assign: (u: string) => assigned.push(u) } };
  let go!: (open: () => Promise<{ url: string } | null>) => Promise<void>;
  function Probe() {
    go = useProviderRedirect().go;
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return (open: () => Promise<{ url: string } | null>) => act(async () => go(open));
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});

describe("useProviderRedirect", () => {
  test("navigates to an https URL", async () => {
    const run = setup();
    await run(async () => ({ url: "https://checkout.stripe.com/c/1" }));
    expect(assigned).toEqual(["https://checkout.stripe.com/c/1"]);
  });

  test.each([["javascript:alert(1)"], ["data:text/html,x"], ["//evil.example/x"], ["http://x.example"]])(
    "never navigates to %s",
    async (url) => {
      const run = setup();
      await run(async () => ({ url }));
      expect(assigned).toEqual([]);
    }
  );
});
