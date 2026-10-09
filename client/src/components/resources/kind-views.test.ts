import { describe, expect, test } from "bun:test";
import { COUNTER_KIND, QUEUE_KIND, TIMER_KIND } from "@convex/lib/resourceKinds";
import { kindViewFor } from "@/components/resources/kind-views";

describe("kindViewFor", () => {
  test("has a view made for each built-in kind", () => {
    for (const kind of [COUNTER_KIND, TIMER_KIND, QUEUE_KIND]) {
      expect(kindViewFor(kind)).not.toBeNull();
    }
  });

  test("leaves another module's kind, even of the same name, to its declarations", () => {
    expect(kindViewFor("rival:counter")).toBeNull();
    expect(kindViewFor("woofx3_wheel_spin:wheel")).toBeNull();
  });

  test("adds to the triggers of a counter alone, for its goals", () => {
    const view = kindViewFor(COUNTER_KIND);
    expect(view?.triggerDetail).toBeDefined();
    expect(kindViewFor(TIMER_KIND)?.triggerDetail).toBeUndefined();
  });
});
