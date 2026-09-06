import { describe, expect, it } from "bun:test";
import { createPollThrottle } from "./poll-throttle";

describe("createPollThrottle", () => {
  it("lets the first caller through", () => {
    const throttle = createPollThrottle(60_000);
    expect(throttle.claim("instance-a", 1_000)).toBe(true);
  });

  it("blocks callers racing in the same tick", () => {
    const throttle = createPollThrottle(60_000);
    // Three widgets mounting together: exactly one call should reach the server.
    const claims = [
      throttle.claim("instance-a", 1_000),
      throttle.claim("instance-a", 1_000),
      throttle.claim("instance-a", 1_000),
    ];
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("blocks a remount inside the window", () => {
    const throttle = createPollThrottle(60_000);
    throttle.claim("instance-a", 1_000);
    expect(throttle.claim("instance-a", 30_000)).toBe(false);
  });

  it("lets a caller through once the window has passed", () => {
    const throttle = createPollThrottle(60_000);
    throttle.claim("instance-a", 1_000);
    expect(throttle.claim("instance-a", 61_000)).toBe(true);
  });

  it("throttles each key independently", () => {
    const throttle = createPollThrottle(60_000);
    throttle.claim("instance-a", 1_000);
    // Switching instances must not inherit the previous instance's window.
    expect(throttle.claim("instance-b", 1_000)).toBe(true);
  });

  it("treats a claim at exactly the window boundary as expired", () => {
    const throttle = createPollThrottle(60_000);
    throttle.claim("instance-a", 1_000);
    expect(throttle.claim("instance-a", 61_000)).toBe(true);
  });

  it("reset clears every window", () => {
    const throttle = createPollThrottle(60_000);
    throttle.claim("instance-a", 1_000);
    throttle.reset();
    expect(throttle.claim("instance-a", 1_000)).toBe(true);
  });
});
