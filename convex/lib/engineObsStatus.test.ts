import { describe, expect, test } from "bun:test";
import { parseObsStatus, UNANSWERED_OBS_STATUS } from "./engineObsStatus";

describe("parseObsStatus", () => {
  test("keeps a well-formed answer", () => {
    expect(parseObsStatus({ state: "retrying", failure: "authentication", address: "obs.lan:4455" })).toEqual({
      state: "retrying",
      failure: "authentication",
      address: "obs.lan:4455",
    });
  });

  test("reads an unknown state as unanswered", () => {
    expect(parseObsStatus({ state: "exploded" })).toEqual(UNANSWERED_OBS_STATUS);
    expect(parseObsStatus(undefined)).toEqual(UNANSWERED_OBS_STATUS);
  });

  test("drops an unknown failure and an empty address", () => {
    expect(parseObsStatus({ state: "connected", failure: "odd", address: "" })).toEqual({
      state: "connected",
      failure: null,
      address: null,
    });
  });
});
