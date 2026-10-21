import type { Cancel, Clock } from "../deps";

interface Scheduled {
  at: number;
  run: () => void;
}

/** A clock that moves only when a test advances it, running what falls due in time order. */
export class FakeClock implements Clock {
  private current: number;
  private readonly pending = new Set<Scheduled>();

  constructor(start = 1_000_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  schedule(delayMs: number, run: () => void): Cancel {
    const entry: Scheduled = { at: this.current + delayMs, run };
    this.pending.add(entry);
    return () => {
      this.pending.delete(entry);
    };
  }

  advance(ms: number): void {
    const until = this.current + ms;
    for (;;) {
      const due = [...this.pending].filter((entry) => entry.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) {
        break;
      }
      this.pending.delete(due);
      this.current = due.at;
      due.run();
    }
    this.current = until;
  }
}
