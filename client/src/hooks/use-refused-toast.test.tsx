import { expect, test } from "bun:test";
import { createCompositionEditor, LocalDocumentSource } from "@woofx3/scene/editor";
import { PROFILES } from "@woofx3/scene/model";
import { act, create } from "react-test-renderer";
import { useRefusedToast } from "./use-refused-toast";
import { useToast } from "./use-toast";

async function mount() {
  let report: ReturnType<typeof useRefusedToast> | null = null;
  let toasts: ReturnType<typeof useToast>["toasts"] = [];
  function Probe() {
    report = useRefusedToast();
    toasts = useToast().toasts;
    return null;
  }
  await act(async () => {
    create(<Probe />);
  });
  return { report: () => report as NonNullable<typeof report>, toasts: () => toasts };
}

test("a command the editor refuses surfaces its reason as a destructive toast", async () => {
  const editor = createCompositionEditor({
    source: new LocalDocumentSource({ layout: { width: 1920, height: 1080 }, widgets: {}, behaviors: {} }),
    profile: PROFILES.alert,
    catalog: [],
  });
  const refused = editor.canvas.patch({ width: -1 });
  expect(refused.ok).toBe(false);

  const probe = await mount();
  await act(async () => probe.report()(refused));

  const [toast] = probe.toasts();
  expect(toast?.title).toBe("This change couldn't be made");
  expect(toast?.variant).toBe("destructive");
  expect(toast?.description).toBe(refused.ok ? undefined : refused.detail);
});

test("an accepted command shows nothing", async () => {
  const probe = await mount();
  const before = probe.toasts().length;
  await act(async () => probe.report()({ ok: true }));
  expect(probe.toasts().length).toBe(before);
});
