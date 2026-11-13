import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { EngineStartingNotice } from "@/components/layout/engine-starting-banner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("EngineStartingNotice", () => {
  test("names the phase and links to the progress screen", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <Router hook={memoryLocation({ path: "/" }).hook}>
          <EngineStartingNotice phase="Installing your alerts" />
        </Router>
      );
    });
    const json = JSON.stringify(renderer?.toJSON());
    expect(json).toContain("Installing your alerts");
    expect(json).toContain("/setup/finish");
  });
});
