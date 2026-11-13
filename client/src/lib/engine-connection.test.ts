import { describe, expect, test } from "bun:test";
import { type EngineConnection, engineConnection } from "@/lib/engine-connection";

describe("engineConnection", () => {
  const cases: { name: string; args: [boolean, boolean, boolean, boolean]; want: EngineConnection }[] = [
    { name: "connected", args: [true, false, false, false], want: "connected" },
    { name: "connected with a limited relay", args: [true, false, true, false], want: "limited" },
    { name: "a connected engine is never starting", args: [true, false, false, true], want: "connected" },
    { name: "still being built", args: [false, false, false, true], want: "starting" },
    { name: "upgrading", args: [false, true, false, false], want: "upgrading" },
    { name: "lost", args: [false, false, false, false], want: "disconnected" },
  ];
  for (const { name, args, want } of cases) {
    test(name, () => {
      expect(engineConnection(...args)).toBe(want);
    });
  }
});
