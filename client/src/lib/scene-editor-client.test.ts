import { describe, expect, it } from "bun:test";
import {
  applyOps,
  type Json0Component,
  type SceneDocument,
  type SceneSnapshot,
  transformOps,
} from "@/lib/scene-document";
import { type EditorSocket, type EditorState, SceneEditorClient } from "@/lib/scene-editor-client";

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
  seq = 0;
  log: Array<{ seq: number; ops: Json0Component[]; opId: string }> = [];
  sockets = new Set<FakeSocket>();
  /** Drop acks and ops events to this socket, as a dying connection would. */
  deaf: FakeSocket | null = null;

  constructor(doc: SceneDocument) {
    this.doc = doc;
  }

  connect(): FakeSocket {
    const socket = new FakeSocket(this);
    this.sockets.add(socket);
    queueMicrotask(() => {
      socket.onopen?.();
      const snapshot = (): SceneSnapshot => ({ sceneId: "s1", name: "Main", seq: this.seq, doc: this.doc, meta: {} });
      socket.deliver({ type: "snapshot", version: "published", snapshot: { ...snapshot(), seq: 0 }, hasDraft: false });
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

  submit(from: FakeSocket, message: any): void {
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
      if (!this.closed && message.type === "submit") {
        this.server.submit(this, message);
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

function editor(server: FakeServer) {
  let state: EditorState = {
    status: "connecting",
    version: "draft",
    others: {},
    doc: null,
    meta: {},
    hasDraft: false,
  };
  const sockets: FakeSocket[] = [];
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
  });
  client.start();
  const text = () => state.doc?.widgets.a?.settings.text;
  const type = (value: string) => {
    const doc = structuredClone(state.doc!);
    doc.widgets.a!.settings.text = value;
    client.edit(doc);
    client.flush();
  };
  return { client, state: () => state, text, type, sockets };
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
