import { useRef } from "react";

// Operation ids name one user intent ("send this line", "pin this message")
// for the engine's platform gateway, which replays its first answer when the
// same id comes back instead of posting again. That makes a double click, or
// a retry after a send Twitch never confirmed, safe: it reuses the id.

/** Makes a fresh operation id: 8 to 64 of `A-Z a-z 0-9 _ -`, as OPERATION_ID_PATTERN in convex/lib/platformGateway.ts requires. */
export type OperationIdSource = () => string;

export const randomOperationId: OperationIdSource = () => crypto.randomUUID();

/**
 * Hands out one operation id per intent. An intent is a string the caller
 * builds from what the user asked for (the action, its target and text), so
 * the same request asked again gets the same id until one attempt succeeds.
 *
 * An id stays open after a failure: the gateway forgets a send that reached
 * no platform, so reusing it sends again, and replays one that may have
 * reached Twitch, so a retry cannot post it twice.
 */
export class IntentOperationIds {
  private readonly open = new Map<string, string>();

  constructor(private readonly source: OperationIdSource = randomOperationId) {}

  /** The open id for `intent`, or a new one. */
  begin(intent: string): string {
    const existing = this.open.get(intent);
    if (existing !== undefined) {
      return existing;
    }
    const id = this.source();
    this.open.set(intent, id);
    return id;
  }

  /** Closes `intent` after `id` succeeded, so asking again is a new intent. A newer id is left open. */
  finish(intent: string, id: string): void {
    if (this.open.get(intent) === id) {
      this.open.delete(intent);
    }
  }

  /** Runs `send` under the intent's id, closing the intent once it resolves. */
  async run<T>(intent: string, send: (operationId: string) => Promise<T>): Promise<T> {
    const id = this.begin(intent);
    const result = await send(id);
    this.finish(intent, id);
    return result;
  }
}

/** One `IntentOperationIds` for the component's lifetime. */
export function useIntentOperationIds(source?: OperationIdSource): IntentOperationIds {
  const ids = useRef<IntentOperationIds | null>(null);
  if (ids.current === null) {
    ids.current = new IntentOperationIds(source);
  }
  return ids.current;
}
