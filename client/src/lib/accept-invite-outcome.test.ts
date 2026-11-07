import { describe, expect, test } from "bun:test";
import { acceptRefusalMessage } from "./accept-invite-outcome";

describe("acceptRefusalMessage", () => {
  test("a joined user gets no refusal", () => {
    expect(acceptRefusalMessage({ status: "already_member", instanceId: "i" as never })).toBeNull();
  });

  test.each([
    ["already_accepted", "already been used"],
    ["expired", "expired"],
    ["revoked", "cancelled"],
    ["not_found", "could not find"],
  ] as const)("%s says so in plain words", (status, words) => {
    expect(acceptRefusalMessage({ status })).toContain(words);
  });
});
