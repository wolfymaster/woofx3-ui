import { describe, expect, it } from "bun:test";
import {
  applyOps,
  diffDocuments,
  type Json0Component,
  type SceneDocument,
  type SceneSnapshot,
  transformOps,
} from "@/lib/scene-document";
import {
  type DroppedWork,
  type EditorSocket,
  type EditorState,
  SceneEditorClient,
  type SceneEditorClientOptions,
} from "@/lib/scene-editor-client";

function placement(text: string) {
  return {
    widget: "woofx3:widget:text",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    visible: true,
    z: "a0000",
    settings: { text },
    name: "Text",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
  };
}

/** The engine's sequencing, in memory: transform late ops, dedupe resubmits. */
class FakeServer {
  doc: SceneDocument;
  published: SceneDocument;
  seq = 0;
  log: Array<{ seq: number; ops: Json0Component[]; opId: string }> = [];
  sockets = new Set<FakeSocket>();
  /** Drop acks, answers and ops events to this socket, as a dying connection would. */
  deaf: FakeSocket | null = null;
  /** Every submit, publish and discard, in the order they arrived. */
  received: string[] = [];
  /** Hold the answer to the next publish until `releaseAnswer`, as a slow engine would. */
  holdAnswer = false;
  private heldAnswer: (() => void) | null = null;
  /** Refuse the next submit as invalid, as the engine does an op it cannot apply. */
  refuseNext = false;
  /** Refuse the submit with this number (counting from 1) as invalid. */
  refuseSubmit: number | null = null;
  private submits = 0;

  constructor(doc: SceneDocument) {
    this.doc = doc;
    this.published = structuredClone(doc);
  }

  connect(): FakeSocket {
    const socket = new FakeSocket(this);
    this.sockets.add(socket);
    queueMicrotask(() => {
      socket.onopen?.();
      const snapshot = (): SceneSnapshot => ({ sceneId: "s1", name: "Main", seq: this.seq, doc: this.doc, meta: {} });
      socket.deliver({
        type: "snapshot",
        version: "published",
        snapshot: { ...snapshot(), seq: 0, doc: this.published },
        hasDraft: false,
      });
      socket.deliver({ type: "snapshot", version: "draft", snapshot: snapshot(), hasDraft: this.seq > 0 });
    });
    return socket;
  }

  presence(from: FakeSocket, message: any): void {
    for (const socket of this.sockets) {
      if (socket !== from) {
        socket.deliver({ type: "presence", editorId: from.id, name: message.name, selection: message.selection });
      }
    }
  }

  publish(from: FakeSocket): void {
    this.published = structuredClone(this.doc);
    const answer = () => from.deliver({ type: "published", hasDraft: false });
    if (this.holdAnswer) {
      this.holdAnswer = false;
      this.heldAnswer = answer;
    } else if (from !== this.deaf) {
      answer();
    }
  }

  releaseAnswer(): void {
    this.heldAnswer?.();
    this.heldAnswer = null;
  }

  /** Resets the draft to what is published, as one op from no editor, before answering. */
  discard(from: FakeSocket): void {
    const ops = diffDocuments(this.doc, this.published);
    if (ops.length > 0) {
      this.doc = structuredClone(this.published);
      this.seq += 1;
      this.log.push({ seq: this.seq, ops, opId: `discard-${this.seq}` });
      for (const socket of this.sockets) {
        if (socket !== this.deaf) {
          socket.deliver({ type: "ops", version: "draft", seq: this.seq, ops, meta: {}, opId: null, hasDraft: false });
        }
      }
    }
    if (from !== this.deaf) {
      from.deliver({ type: "discarded", hasDraft: false });
    }
  }

  submit(from: FakeSocket, message: any): void {
    this.submits += 1;
    if (this.refuseNext || this.refuseSubmit === this.submits) {
      this.refuseNext = false;
      from.deliver({ type: "reject", opId: message.opId, version: "draft", error: "invalid" });
      return;
    }
    const known = this.log.find((entry) => entry.opId === message.opId);
    if (known) {
      from.deliver({ type: "ack", opId: message.opId, version: "draft", seq: known.seq });
      return;
    }
    let ops: Json0Component[] = message.ops;
    for (const entry of this.log.filter((e) => e.seq > message.base)) {
      ops = transformOps(ops, entry.ops, "left");
    }
    this.doc = applyOps(this.doc, ops);
    this.seq += 1;
    this.log.push({ seq: this.seq, ops, opId: message.opId });
    for (const socket of this.sockets) {
      if (socket !== this.deaf) {
        socket.deliver({
          type: "ops",
          version: "draft",
          seq: this.seq,
          ops,
          meta: {},
          opId: message.opId,
          hasDraft: true,
        });
      }
    }
    if (from !== this.deaf) {
      from.deliver({ type: "ack", opId: message.opId, version: "draft", seq: this.seq });
    }
  }
}

let socketIds = 0;

class FakeSocket implements EditorSocket {
  readonly id = `editor-${++socketIds}`;
  readonly sent: any[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(private readonly server: FakeServer) {}
  send(data: string): void {
    if (this.closed) {
      return;
    }
    const message = JSON.parse(data);
    // The network: the server sees it on a later tick.
    queueMicrotask(() => {
      if (!this.closed && ["submit", "publish", "discard"].includes(message.type)) {
        this.server.received.push(message.type === "submit" ? `submit:${message.version}` : message.type);
      }
      if (!this.closed && message.type === "submit") {
        this.server.submit(this, message);
      }
      if (!this.closed && message.type === "publish") {
        this.server.publish(this);
      }
      if (!this.closed && message.type === "discard") {
        this.server.discard(this);
      }
      if (!this.closed && message.type === "presence") {
        this.sent.push(message);
        this.server.presence(this, message);
      }
    });
  }
  close(): void {
    this.closed = true;
    this.server.sockets.delete(this);
    this.onclose?.();
  }
  deliver(message: unknown): void {
    if (!this.closed) {
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(message) }));
    }
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function editor(server: FakeServer, overrides: Partial<SceneEditorClientOptions> = {}) {
  let state: EditorState = {
    status: "connecting",
    version: "draft",
    others: {},
    doc: null,
    meta: {},
    hasDraft: false,
    unsaved: false,
  };
  const sockets: FakeSocket[] = [];
  let closed = false;
  const client = new SceneEditorClient({
    open: async () => "ws://fake",
    createSocket: () => {
      const socket = server.connect();
      sockets.push(socket);
      return socket;
    },
    onChange: (next) => {
      state = next;
    },
    flushMs: 1,
    retryDelayMs: () => 1,
    ...overrides,
    onClose: () => {
      closed = true;
      overrides.onClose?.();
    },
  });
  client.start();
  const text = () => state.doc?.widgets.a?.settings.text;
  const type = (value: string) => {
    const doc = structuredClone(state.doc!);
    doc.widgets.a!.settings.text = value;
    client.edit(doc, state.version);
    client.flush();
  };
  return { client, state: () => state, text, type, sockets, closed: () => closed };
}

describe("SceneEditorClient", () => {
  it("sends an edit, and the server takes it", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const e = editor(server);
    await settle();
    expect(e.state().status).toBe("ready");
    // The editor already shows its own edit, so it is not reported back.
    e.type("hi there");
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("hi there");
    expect(e.state().hasDraft).toBe(true);
  });

  it("keeps one submit in flight and folds later edits into the next", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    for (const value of ["h", "he", "hel", "hell", "hello"]) {
      e.type(value);
    }
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("hello");
    expect(server.log.length).toBe(2);
  });

  it("converges two editors typing in one field at once, keeping both", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("Thanks") } });
    const one = editor(server);
    const two = editor(server);
    await settle();
    one.type("Thanks!");
    two.type("Big Thanks");
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("Big Thanks!");
    expect(one.text()).toBe("Big Thanks!");
    expect(two.text()).toBe("Big Thanks!");
  });

  it("resends what was unconfirmed after a reconnect, and converges", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("Thanks") } });
    const one = editor(server);
    const two = editor(server);
    await settle();
    // One's edit is never sent: the socket drops first.
    one.sockets[0]!.closed = true;
    one.type("Thanks!");
    two.type("Big Thanks");
    await settle();
    one.sockets[0]!.closed = false;
    one.sockets[0]!.close();
    await settle();
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("Big Thanks!");
    expect(one.text()).toBe("Big Thanks!");
    expect(two.text()).toBe("Big Thanks!");
  });

  it("does not apply an op twice when only its ack was lost", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const e = editor(server);
    await settle();
    server.deaf = e.sockets[0]!;
    e.type("hi!");
    await settle();
    server.deaf = null;
    e.sockets[0]!.close();
    await settle();
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("hi!");
    expect(server.log.length).toBe(1);
    expect(e.text()).toBe("hi!");
  });

  it("reports an engine that cannot edit the scene", async () => {
    let state: EditorState | null = null;
    const client = new SceneEditorClient({
      open: async () => null,
      onChange: (next) => {
        state = next;
      },
    });
    client.start();
    await settle();
    expect(state!.status).toBe("unavailable");
  });
});

describe("SceneEditorClient — presence and live editing", () => {
  it("hears where the other editors are, and forgets one that leaves", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const one = editor(server);
    const two = editor(server);
    await settle();
    one.client.setPresence({ name: "Wolfy", selection: "a" });
    await settle();
    expect(Object.values(two.state().others)).toEqual([{ name: "Wolfy", selection: "a" }]);
    const [editorId] = Object.keys(two.state().others);
    two.sockets[0]!.deliver({ type: "presence", editorId, left: true });
    await settle();
    expect(two.state().others).toEqual({});
  });

  it("announces itself again after a reconnect", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const one = editor(server);
    await settle();
    one.client.setPresence({ name: "Wolfy", selection: "a" });
    await settle();
    one.sockets[0]!.close();
    await settle();
    await settle();
    expect(one.sockets[1]!.sent).toEqual([{ type: "presence", name: "Wolfy", selection: "a" }]);
  });

  it("edits the published scene when switched to live", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const one = editor(server);
    await settle();
    one.client.setVersion("published");
    expect(one.state().version).toBe("published");
    const sent: any[] = [];
    const socket = one.sockets[0]!;
    const original = socket.send.bind(socket);
    socket.send = (data: string) => {
      sent.push(JSON.parse(data));
      original(data);
    };
    one.type("hello");
    expect(sent.at(-1)).toMatchObject({ type: "submit", version: "published" });
  });
});

describe("SceneEditorClient — what the editor shows, and what reaches the engine", () => {
  it("reports an edit not yet sent, so the canvas never steps back to the last send", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const one = editor(server);
    const two = editor(server);
    await settle();
    const doc = structuredClone(one.state().doc!);
    doc.widgets.a!.x = 40;
    // Not flushed: still waiting for the next send when something else is reported.
    one.client.edit(doc, "draft");
    two.client.setPresence({ name: "Other", selection: null });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(one.state().doc!.widgets.a!.x).toBe(40);
  });

  it("drops an edit of a canvas read from the version it is not editing", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const e = editor(server);
    await settle();
    const draftCanvas = structuredClone(e.state().doc!);
    draftCanvas.widgets.a!.settings.text = "draft only";
    e.client.setVersion("published");
    e.client.edit(draftCanvas, "draft");
    e.client.flush();
    await settle();
    expect(server.received).toEqual([]);
  });

  it("publishes only after the edits made before it are sent", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    e.type("h");
    // Waits behind the first, which has no ack yet.
    e.type("hello");
    e.client.publish();
    await settle();
    expect(server.received).toEqual(["submit:draft", "submit:draft", "publish"]);
  });

  it("reports edits on their way, and then that they arrived", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    e.type("hi");
    expect(e.state().unsaved).toBe(true);
    await settle();
    expect(e.state().unsaved).toBe(false);
  });

  it("keeps the socket open on stop until the edits made before it are confirmed", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    e.type("h");
    e.type("hello");
    e.client.stop();
    expect(e.sockets[0]!.closed).toBe(false);
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("hello");
    expect(e.sockets[0]!.closed).toBe(true);
  });

  it("does not diff a canvas waiting for its version's snapshot against the other version", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const e = editor(server);
    // Before any snapshot: there is nothing to diff the draft canvas against yet.
    e.client.edit({ layout: {}, widgets: { a: placement("draft only") } }, "draft");
    e.client.setVersion("published");
    await settle();
    e.client.flush();
    await settle();
    expect(server.received).toEqual([]);
    expect(server.doc.widgets.a!.settings.text).toBe("hi");
  });

  it("publishes after a reconnect only once the draft's unconfirmed edits are resent", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    e.sockets[0]!.close();
    e.type("hello");
    e.client.publish();
    await settle();
    await settle();
    expect(server.received).toEqual(["submit:draft", "publish"]);
  });

  it("sends every publish and discard asked for, in order", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    e.sockets[0]!.close();
    e.client.publish();
    e.client.discard();
    await settle();
    await settle();
    expect(server.received).toEqual(["publish", "discard"]);
  });

  it("reconnects on stop to deliver edits made while the socket was down", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    e.sockets[0]!.close();
    e.type("hello");
    e.client.stop();
    await settle();
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("hello");
    expect(e.sockets[1]!.closed).toBe(true);
  });

  it("reports the edits saved when the last change turns out to change nothing", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const one = editor(server);
    const two = editor(server);
    await settle();
    one.client.edit(structuredClone(one.state().doc!), "draft");
    // Something else is reported while that edit waits for the next send.
    two.client.setPresence({ name: "Other", selection: null });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(one.state().unsaved).toBe(true);
    one.client.flush();
    expect(one.state().unsaved).toBe(false);
  });

  it("clears its selection for the others while it drains", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const one = editor(server);
    const two = editor(server);
    await settle();
    one.client.setPresence({ name: "Wolfy", selection: "a" });
    await settle();
    one.type("hi!");
    one.client.stop();
    await settle();
    expect(one.sockets[0]!.sent.at(-1)).toEqual({ type: "presence", name: "Wolfy", selection: null });
    expect(Object.values(two.state().others)).toEqual([{ name: "Wolfy", selection: null }]);
    expect(one.sockets[0]!.closed).toBe(true);
  });

  it("drops an edit made before its version's first snapshot, so a canvas from another session is never sent", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const e = editor(server);
    // A canvas the editor still shows from before this client existed.
    e.client.edit({ layout: {}, widgets: { a: placement("stale canvas") } }, "draft");
    await settle();
    e.client.flush();
    await settle();
    expect(server.received).toEqual([]);
    expect(e.text()).toBe("hi");
  });

  it("keeps edits made on a loaded canvas while the socket reconnects", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    e.sockets[0]!.close();
    const doc = structuredClone(e.state().doc!);
    doc.widgets.a!.settings.text = "while reconnecting";
    e.client.edit(doc, "draft");
    await settle();
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("while reconnecting");
    expect(e.text()).toBe("while reconnecting");
  });

  it("closes at once on abandon, without resending what is unconfirmed", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const e = editor(server);
    await settle();
    server.deaf = e.sockets[0]!;
    e.type("hi!");
    e.client.abandon();
    expect(e.sockets[0]!.closed).toBe(true);
    server.deaf = null;
    await settle();
    await settle();
    expect(e.sockets.length).toBe(1);
  });

  it("does nothing on a stop after abandon or a second stop", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    server.deaf = e.sockets[0]!;
    e.type("hello");
    e.client.abandon();
    e.client.stop();
    await settle();
    await settle();
    expect(e.sockets.length).toBe(1);
    expect(e.sockets[0]!.closed).toBe(true);
  });

  it("keeps every version's document current while it drains", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi") } });
    const one = editor(server);
    const two = editor(server);
    await settle();
    // One drains on an edit of the published scene that never reaches the
    // server, with nothing of the draft's pending.
    one.client.setVersion("published");
    const socket = one.sockets[0]!;
    const original = socket.send.bind(socket);
    socket.send = (data: string) => {
      if (JSON.parse(data).type !== "submit") {
        original(data);
      }
    };
    one.type("live");
    one.client.stop();
    two.type("hi there");
    await settle();
    const draft = (one.client as unknown as { versions: { draft: { seq: number; doc: SceneDocument } } }).versions
      .draft;
    expect(draft.seq).toBe(server.seq);
    expect(draft.doc.widgets.a!.settings.text).toBe("hi there");
  });
});

describe("SceneEditorClient — draining after stop, and commands behind refused edits", () => {
  it("reconnects at once on stop instead of waiting out a long backoff", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server, { retryDelayMs: () => 10_000, drainMs: 1_000 });
    await settle();
    e.sockets[0]!.close();
    e.type("hello");
    e.client.stop();
    await settle();
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("hello");
    expect(e.sockets[1]!.closed).toBe(true);
  });

  it("keeps reconnect attempts short while it drains", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    let opens = 0;
    const e = editor(server, {
      retryDelayMs: () => 10_000,
      drainMs: 2_000,
      open: async () => {
        opens += 1;
        if (opens === 2) {
          throw new Error("engine briefly unreachable");
        }
        return "ws://fake";
      },
    });
    await settle();
    e.sockets[0]!.close();
    e.type("hello");
    e.client.stop();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(server.doc.widgets.a!.settings.text).toBe("hello");
    expect(e.closed()).toBe(true);
  });

  it("closes at once on stop when the engine will not open a session", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    let opens = 0;
    let closed = false;
    const e = editor(server, {
      open: async () => {
        opens += 1;
        return opens === 1 ? "ws://fake" : null;
      },
      onClose: () => {
        closed = true;
      },
    });
    await settle();
    e.sockets[0]!.close();
    await settle();
    expect(e.state().status).toBe("unavailable");
    e.type("hello");
    e.client.stop();
    expect(closed).toBe(true);
    expect(e.closed()).toBe(true);
  });

  it("holds a publish until the edit before it is acknowledged", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    server.deaf = e.sockets[0]!;
    e.type("hello");
    e.client.publish();
    await settle();
    expect(server.received).toEqual(["submit:draft"]);
  });

  it("drops and reports a publish waiting behind an edit the engine refused", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    let dropped: string[] = [];
    let reason = "";
    const e = editor(server, {
      onDropped: (work) => {
        dropped = work.commands;
        reason = work.reason;
      },
    });
    await settle();
    server.refuseNext = true;
    e.type("hello");
    e.client.publish();
    await settle();
    expect(server.received).toEqual(["submit:draft"]);
    expect(dropped).toEqual(["publish"]);
    expect(reason).toBe("refused");
  });

  it("sends a publish once the edits before it are acknowledged, ahead of edits made after it", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    e.type("h");
    e.client.publish();
    // Still typing after the click, faster than the acks come back.
    e.type("he");
    e.type("hel");
    await settle();
    expect(server.received).toEqual(["submit:draft", "publish", "submit:draft"]);
    expect(server.doc.widgets.a!.settings.text).toBe("hel");
  });

  it("keeps an edit buffered before the click ahead of the publish, and later edits behind it", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    e.type("h");
    // Buffered behind the first, which has no ack yet: made before the click.
    e.type("he");
    e.client.publish();
    e.type("hey");
    await settle();
    expect(server.received).toEqual(["submit:draft", "submit:draft", "publish", "submit:draft"]);
  });

  it("still sends a publish when an edit made after it is refused", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    let dropped: string[] = [];
    const e = editor(server, {
      onDropped: (work) => {
        dropped = work.commands;
      },
    });
    await settle();
    server.refuseSubmit = 2;
    e.type("h");
    e.client.publish();
    e.type("hello");
    await settle();
    expect(server.received.slice(0, 3)).toEqual(["submit:draft", "publish", "submit:draft"]);
    expect(dropped).toEqual([]);
  });

  it("drops a publish when an edit before it is refused, even with edits made after it", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    let dropped: string[] = [];
    const e = editor(server, {
      onDropped: (work) => {
        dropped = work.commands;
      },
    });
    await settle();
    server.refuseSubmit = 1;
    e.type("h");
    e.client.publish();
    e.type("hello");
    await settle();
    expect(server.received).not.toContain("publish");
    expect(dropped).toEqual(["publish"]);
  });

  it("reports a publish still waiting when the drain runs out", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    let dropped: string[] = [];
    let reason = "";
    const e = editor(server, {
      drainMs: 30,
      onDropped: (work) => {
        dropped = work.commands;
        reason = work.reason;
      },
    });
    await settle();
    server.deaf = e.sockets[0]!;
    e.type("hello");
    e.client.publish();
    e.client.stop();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(e.closed()).toBe(true);
    expect(dropped).toEqual(["publish"]);
    expect(reason).toBe("undelivered");
  });

  it("gives up reconnecting while it drains after a few attempts", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    let opens = 0;
    const e = editor(server, {
      drainMs: 5_000,
      open: async () => {
        opens += 1;
        if (opens > 1) {
          throw new Error("engine unreachable");
        }
        return "ws://fake";
      },
    });
    await settle();
    e.sockets[0]!.close();
    e.type("hello");
    e.client.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(opens).toBeLessThanOrEqual(8);
    expect(e.closed()).toBe(true);
  });

  it("counts a queued publish as pending work", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    server.deaf = e.sockets[0]!;
    e.type("hello");
    e.client.publish();
    await settle();
    expect(e.client.hasPending()).toBe(true);
  });
});

describe("SceneEditorClient — edits made behind a Publish or Discard", () => {
  it("keeps showing and then sends edits made behind a publish across a reconnect", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const e = editor(server);
    await settle();
    // The engine takes the edit but its ack is lost, so the publish waits.
    server.deaf = e.sockets[0]!;
    e.type("h");
    e.client.publish();
    e.type("hello");
    await settle();
    server.deaf = null;
    e.sockets[0]!.close();
    await settle();
    expect(e.text()).toBe("hello");
    await settle();
    await settle();
    expect(server.received.filter((entry) => entry === "publish")).toEqual(["publish"]);
    expect(server.doc.widgets.a!.settings.text).toBe("hello");
    expect(server.published.widgets.a!.settings.text).toBe("h");
    expect(e.text()).toBe("hello");
    expect(e.state().unsaved).toBe(false);
  });

  it("does not move edits made behind a publish by a resent edit's echo", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("abcd") } });
    const e = editor(server);
    await settle();
    // Nothing reaches the engine until the socket drops and reconnects.
    e.sockets[0]!.closed = true;
    e.type("abXcd");
    e.client.publish();
    e.type("abXcYd");
    e.sockets[0]!.closed = false;
    e.sockets[0]!.close();
    await settle();
    await settle();
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("abXcYd");
    expect(server.published.widgets.a!.settings.text).toBe("abXcd");
    expect(e.text()).toBe("abXcYd");
  });

  it("keeps edits made behind a discard on the discarded draft", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("ab") } });
    const e = editor(server);
    await settle();
    e.type("abc");
    e.client.discard();
    e.type("abcZ");
    await settle();
    expect(server.received).toEqual(["submit:draft", "discard", "submit:draft"]);
    expect(server.doc.widgets.a!.settings.text).toBe("abZ");
    expect(e.text()).toBe("abZ");
  });

  it("sends edits made behind a discard whose answer was lost against the draft before it", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("ab") } });
    const e = editor(server);
    await settle();
    e.type("abc");
    await settle();
    server.deaf = e.sockets[0]!;
    e.client.discard();
    e.type("abcZ");
    await settle();
    server.deaf = null;
    e.sockets[0]!.close();
    await settle();
    await settle();
    expect(server.doc.widgets.a!.settings.text).toBe("abZ");
    expect(e.text()).toBe("abZ");
  });

  it("carries another editor's change into edits held behind a publish", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("hi"), b: placement("x") } });
    const one = editor(server);
    const two = editor(server);
    await settle();
    server.holdAnswer = true;
    one.type("hi!");
    one.client.publish();
    one.type("hi!!");
    await settle();
    const doc = structuredClone(two.state().doc!);
    doc.widgets.b!.settings.text = "moved";
    two.client.edit(doc, "draft");
    two.client.flush();
    await settle();
    expect(one.state().doc!.widgets.b!.settings.text).toBe("moved");
    expect(one.text()).toBe("hi!!");
    server.releaseAnswer();
    await settle();
    expect(server.received).toEqual(["submit:draft", "publish", "submit:draft", "submit:draft"]);
    expect(server.doc.widgets.a!.settings.text).toBe("hi!!");
    expect(server.doc.widgets.b!.settings.text).toBe("moved");
  });
});

describe("SceneEditorClient — what a drain that runs out reports", () => {
  it("reports edits still unconfirmed when the drain runs out", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const reports: DroppedWork[] = [];
    const e = editor(server, { drainMs: 30, onDropped: (work) => reports.push(work) });
    await settle();
    server.deaf = e.sockets[0]!;
    e.type("hello");
    e.client.stop();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(e.closed()).toBe(true);
    expect(reports).toEqual([{ reason: "undelivered", commands: [], edits: true }]);
  });

  it("reports nothing when a drain delivers everything", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const reports: DroppedWork[] = [];
    const e = editor(server, { onDropped: (work) => reports.push(work) });
    await settle();
    e.type("hello");
    e.client.publish();
    e.client.stop();
    await settle();
    expect(e.closed()).toBe(true);
    expect(reports).toEqual([]);
  });

  it("lets a reconnect begun before the drain's deadline finish delivering", async () => {
    const server = new FakeServer({ layout: {}, widgets: { a: placement("") } });
    const reports: DroppedWork[] = [];
    let opens = 0;
    const e = editor(server, {
      drainMs: 100,
      onDropped: (work) => reports.push(work),
      // Each reconnect's session takes a while to open; the first fails.
      open: async () => {
        opens += 1;
        if (opens === 1) {
          return "ws://fake";
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (opens === 2) {
          throw new Error("engine briefly unreachable");
        }
        return "ws://fake";
      },
    });
    await settle();
    e.sockets[0]!.close();
    e.type("hello");
    e.client.stop();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(server.doc.widgets.a!.settings.text).toBe("hello");
    expect(reports).toEqual([]);
    expect(e.closed()).toBe(true);
  });
});
