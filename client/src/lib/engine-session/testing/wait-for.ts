/**
 * Resolves once `condition` holds. capnweb over a `MessageChannel` delivers
 * on the real event loop, so a test waits for a message to land rather than
 * advancing a fake clock.
 */
export async function waitFor(condition: () => boolean, what: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
