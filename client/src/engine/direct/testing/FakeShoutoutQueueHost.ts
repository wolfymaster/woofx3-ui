import type { ShoutoutChannel, ShoutoutEnqueued, ShoutoutEntry, ShoutoutQueueView } from "@/desktop/host";
import type { ShoutoutQueueHost } from "../shoutouts";

/** The desktop host's shoutout queue, in memory: it numbers entries, drops one that is gone, and reports each change. */
export class FakeShoutoutQueueHost implements ShoutoutQueueHost {
  entries: ShoutoutEntry[] = [];
  pausedReason: string | null = null;
  /** Makes the next `reorder` reject, as a host that lost its engine does. */
  failReorder: string | null = null;
  readonly enqueued: ShoutoutChannel[] = [];
  listeners = 0;
  private nextId = 1;
  private readonly handlers = new Set<(queue: ShoutoutQueueView) => void>();

  view(): ShoutoutQueueView {
    return { entries: [...this.entries], pausedReason: this.pausedReason };
  }

  async queue(): Promise<ShoutoutQueueView> {
    return this.view();
  }

  async enqueue(channel: ShoutoutChannel): Promise<ShoutoutEnqueued> {
    this.enqueued.push(channel);
    const existing = this.entries.find((entry) => entry.twitchUserId === channel.twitchUserId);
    if (existing) {
      return { id: existing.id, position: this.entries.indexOf(existing) + 1, alreadyQueued: true };
    }
    const entry: ShoutoutEntry = {
      ...channel,
      id: this.nextId,
      attempts: 0,
      nextEligibleAt: 0,
      lastError: null,
    };
    this.nextId += 1;
    this.entries.push(entry);
    this.publish();
    return { id: entry.id, position: this.entries.length, alreadyQueued: false };
  }

  async remove(entryId: number): Promise<void> {
    if (!this.entries.some((entry) => entry.id === entryId)) {
      throw "that shoutout is no longer queued";
    }
    this.entries = this.entries.filter((entry) => entry.id !== entryId);
    this.publish();
  }

  async reorder(entryIds: number[]): Promise<void> {
    if (this.failReorder !== null) {
      throw this.failReorder;
    }
    const named = entryIds.flatMap((id) => this.entries.filter((entry) => entry.id === id));
    this.entries = [...named, ...this.entries.filter((entry) => !entryIds.includes(entry.id))];
    this.publish();
  }

  async onChange(handler: (queue: ShoutoutQueueView) => void): Promise<() => void> {
    this.handlers.add(handler);
    this.listeners += 1;
    return () => {
      this.handlers.delete(handler);
      this.listeners -= 1;
    };
  }

  /** What the host reports on its own, e.g. the pacing worker sending an entry. */
  publish(): void {
    for (const handler of this.handlers) {
      handler(this.view());
    }
  }
}
