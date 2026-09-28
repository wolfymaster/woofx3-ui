/**
 * Keeps a slow read from overwriting a newer write.
 *
 * A poll and a user's change can be in flight together; if the poll started
 * first but answers last, adopting it would flip a switch back to what it was
 * before the click. Each read takes a ticket when it starts, and the ticket is
 * current only while no write has started since.
 */
export interface WriteFence {
  /** Call as a write starts. Every read begun before this is now stale. */
  write(): void;
  /** Call as a read starts; the returned check says whether to adopt its answer. */
  read(): () => boolean;
}

export function createWriteFence(): WriteFence {
  let writes = 0;
  return {
    write() {
      writes += 1;
    },
    read() {
      const startedAt = writes;
      return () => startedAt === writes;
    },
  };
}
