/**
 * Numbers requests so only the newest one may write its answer. A slow
 * earlier request that resolves after a newer one would otherwise overwrite
 * it, which is easy to hit by typing in a search box.
 */
export interface RequestSequence {
  /** Starts a request and returns its ticket; every earlier ticket is now stale. */
  next(): number;
  isCurrent(ticket: number): boolean;
}

export function createRequestSequence(): RequestSequence {
  let latest = 0;
  return {
    next(): number {
      latest += 1;
      return latest;
    },
    isCurrent(ticket: number): boolean {
      return ticket === latest;
    },
  };
}
