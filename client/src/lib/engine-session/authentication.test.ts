import { describe, expect, test } from "bun:test";
import { isAuthenticationRefused } from "./authentication";

describe("isAuthenticationRefused", () => {
  const cases: Array<{ name: string; error: unknown; refused: boolean }> = [
    { name: "the engine's refusal", error: new Error("Invalid client credentials"), refused: true },
    {
      name: "the engine's named refusal",
      error: new Error("AuthenticationRefused: Invalid client credentials"),
      refused: true,
    },
    { name: "the prefix anywhere but the start", error: new Error("got AuthenticationRefused: x"), refused: false },
    { name: "a broken socket", error: new Error("Peer closed MessagePort connection."), refused: false },
    { name: "a refusal that is not an Error", error: "Invalid client credentials", refused: false },
    { name: "nothing at all", error: undefined, refused: false },
  ];

  for (const { name, error, refused } of cases) {
    test(name, () => {
      expect(isAuthenticationRefused(error)).toBe(refused);
    });
  }
});
