import { describe, expect, test } from "bun:test";
import { create } from "react-test-renderer";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { BackToDashboard } from "./back-to-dashboard";

function render(hasEngine: boolean): string {
  const memory = memoryLocation({ path: "/account" });
  return JSON.stringify(
    create(
      <Router hook={memory.hook}>
        <BackToDashboard hasEngine={hasEngine} />
      </Router>
    ).toJSON()
  );
}

describe("BackToDashboard", () => {
  test("links to the dashboard for a viewer with an engine", () => {
    expect(render(true)).toContain("Back to dashboard");
  });

  test("is not offered to a viewer with no engine, where it would loop back to the account", () => {
    expect(render(false)).toBe("null");
  });
});
