import type { SyncClock, SyncSocket, SyncSocketHandlers } from "@woofx3/api/scene-editor/client";
import type { SceneDocument } from "@woofx3/api/scene-editor/document";
import { decodeClientMessage, type ServerMessage } from "@woofx3/api/scene-editor/protocol";
import {
  commit,
  createSequencerState,
  decideDuplicate,
  decideWelcome,
  prepare,
  recordRefusal,
  type SequencerState,
  watermarkOf,
} from "@woofx3/api/scene-editor/sequencer";

/**
 * Test support: `SceneSyncClient`s against the engine's pure sequencer behind
 * an in-memory socket, so tests of the editor's wiring run the real protocol
 * rather than a model of it. Messages wait in per-socket queues until `run()`
 * delivers them, in order, both ways.
 */

interface Link {
  handlers: SyncSocketHandlers;
  toServer: string[];
  toClient: string[];
  opened: boolean;
  closed: boolean;
  welcomed: boolean;
  clientId: string | null;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/** A clock that moves only when told, running due timers in order. */
export class TestClock implements SyncClock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      let due: [number, { at: number; callback: () => void }] | null = null;
      for (const timer of this.timers) {
        if (timer[1].at <= end && (due === null || timer[1].at < due[1].at)) {
          due = timer;
        }
      }
      if (due === null) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
      await settle();
    }
    this.time = end;
    await settle();
  }
}

export class TestSceneServer {
  readonly state: SequencerState;
  private readonly links: Link[] = [];

  constructor(
    private readonly clock: SyncClock,
    doc: SceneDocument
  ) {
    this.state = createSequencerState({
      docs: { draft: structuredClone(doc), published: structuredClone(doc) },
      hasDraft: false,
      editorState: { v: 0, headId: "", clients: {} },
      epoch: "test",
    });
  }

  connect = (_url: string, handlers: SyncSocketHandlers): SyncSocket => {
    const link: Link = {
      handlers,
      toServer: [],
      toClient: [],
      opened: false,
      closed: false,
      welcomed: false,
      clientId: null,
    };
    this.links.push(link);
    return {
      send: (text) => {
        if (!link.closed) {
          link.toServer.push(text);
        }
      },
      close: () => {
        link.closed = true;
      },
    };
  };

  /** Deliver everything queued, both ways, until nothing moves. */
  async run(): Promise<void> {
    // A client opens its socket once its `open()` promise settles.
    await settle();
    for (let moved = true; moved; ) {
      moved = false;
      for (const link of [...this.links]) {
        if (link.closed) {
          continue;
        }
        if (!link.opened) {
          link.opened = true;
          link.handlers.onOpen();
          moved = true;
        }
        for (const text of link.toServer.splice(0)) {
          this.receive(link, text);
          moved = true;
        }
        for (const text of link.toClient.splice(0)) {
          if (!link.closed) {
            link.handlers.onMessage(text);
            moved = true;
          }
        }
      }
      await settle();
    }
  }

  /** Drop every open socket, losing what is still queued on it. */
  disconnectAll(): void {
    for (const link of this.links) {
      if (!link.closed) {
        link.closed = true;
        link.toServer = [];
        link.toClient = [];
        link.handlers.onClose(1006, "");
      }
    }
  }

  private send(link: Link, message: ServerMessage): void {
    if (!link.closed) {
      link.toClient.push(JSON.stringify(message));
    }
  }

  private receive(link: Link, text: string): void {
    const message = decodeClientMessage(text);
    if (message === null) {
      throw new Error(`not a protocol 2 message: ${text}`);
    }
    if (message.type === "hello") {
      link.clientId = message.clientId;
      const decision = decideWelcome(this.state, message.have);
      const base = {
        type: "welcome" as const,
        protocol: 2 as const,
        features: [],
        clientId: message.clientId,
        last: watermarkOf(this.state, message.clientId),
      };
      if (decision.kind === "catchup") {
        this.send(link, { ...base, catchup: decision.entries });
      } else {
        this.send(link, {
          ...base,
          snapshot: {
            v: this.state.v,
            id: this.state.headId,
            docs: this.state.docs,
            meta: { draft: {}, published: {} },
            hasDraft: this.state.hasDraft,
            name: "Scene",
          },
          diverged: decision.diverged,
        });
      }
      link.welcomed = true;
      return;
    }
    if (message.type === "presence" || link.clientId === null) {
      return;
    }
    const src = { clientId: link.clientId, seq: message.seq };
    const duplicate = decideDuplicate(this.state, src);
    if (duplicate !== null) {
      this.send(link, duplicate);
      return;
    }
    const plan = prepare(this.state, message.base, message.body);
    if (plan.refused) {
      this.send(link, recordRefusal(this.state, src, plan, this.clock.now()));
      return;
    }
    const entry = commit(this.state, plan, {}, src, this.clock.now());
    if (entry === null) {
      this.send(link, { type: "ack", seq: src.seq, v: this.state.v });
      return;
    }
    for (const other of this.links) {
      if (other.welcomed) {
        this.send(other, { type: "entry", ...entry });
      }
    }
  }
}
