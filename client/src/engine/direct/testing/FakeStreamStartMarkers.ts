import type { StreamStartMarkerRequest, StreamStartMarkers } from "@/engine/desktop-host";

/**
 * The desktop host's stream start marker for tests: a request answers with
 * `answer`, a queued one stays pending until `goLive`, and every change is
 * told to the listeners, as the host's window event does.
 */
export class FakeStreamStartMarkers implements StreamStartMarkers {
  pending = false;
  requests = 0;
  answer: StreamStartMarkerRequest = {
    status: "queued",
    reason: "The marker will be dropped when your stream goes live.",
  };
  private readonly listeners = new Set<(pending: boolean) => void>();

  readonly isPending = async (): Promise<boolean> => this.pending;

  readonly onPendingChange = async (listener: (pending: boolean) => void): Promise<() => void> => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly request = async (): Promise<StreamStartMarkerRequest> => {
    this.requests += 1;
    if (this.answer.status === "queued") {
      this.setPending(true);
    }
    return this.answer;
  };

  /** The stream went live, so the host dropped the waiting marker. */
  goLive(): void {
    this.setPending(false);
  }

  get listening(): number {
    return this.listeners.size;
  }

  private setPending(pending: boolean): void {
    this.pending = pending;
    for (const listener of this.listeners) {
      listener(pending);
    }
  }
}
