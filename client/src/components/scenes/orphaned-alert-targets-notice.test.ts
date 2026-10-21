import { describe, expect, it } from "bun:test";
import { alertTargetUsesText } from "./orphaned-alert-targets-notice";

describe("alertTargetUsesText", () => {
  it("names each use with what it is", () => {
    expect(
      alertTargetUsesText({
        target: "sidebar",
        uses: [
          { target: "sidebar", kind: "workflow", name: "Follow alert" },
          { target: "sidebar", kind: "command", name: "!hype" },
        ],
      })
    ).toBe("Follow alert (workflow), !hype (command)");
  });
});
