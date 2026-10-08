import {
  applyOps,
  composeOps,
  diffDocuments,
  type Json0Component,
  type PlacementMeta,
  type SceneDocument,
  type SceneSnapshot,
  type SceneVersion,
  transformOps,
} from "@/lib/scene-document";

/**
 * The scene editor's side of sceneManager's editor socket.
 *
 * The editor hands this the document it shows whenever the streamer changes
 * something (`edit`); at most every `flushMs` the difference from what this
 * last saw is sent as json0 ops. One submit is in flight at a time and later
 * edits compose into one buffered op, so typing or dragging sends a few ops a
 * second however fast it is. Edits show at once: the document this reports is
 * what the server confirmed with the pending ops applied, and with the
 * editor's latest edit, not yet sent, on top. Reporting less would hand the
 * editor a canvas older than the one it shows, and a widget being dragged
 * would jump back to where it was at the last send.
 *
 * Another editor's ops are transformed against the pending ones the way the
 * server transforms the pending ones against them (theirs win a tie), so every
 * editor converges on the server's document. A dropped socket reconnects with
 * a fresh session and resends the unconfirmed ops against the number they
 * were made at; the server transforms them against what was missed, and knows
 * one it already applied by its id.
 *
 * Each edit names the version its canvas was read from, and one read from
 * the other version is dropped: diffed against the wrong version, a canvas
 * read from the draft would push every draft change to what OBS shows, and
 * one read from the published scene would undo the draft's own edits.
 *
 * `publish` and `discard` wait for the draft's edits to be on the wire, so a
 * publish includes the last change made before it. `stop` keeps the socket
 * open until the edits made before it are confirmed, so leaving the editor
 * loses none of them.
 */

/** The slice of a WebSocket this uses (injectable for tests). */
export interface EditorSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type EditorStatus = "connecting" | "ready" | "reconnecting" | "unavailable" | "closed";

/** Another editor of the scene: who, and the widget it has selected. */
export interface EditorPresence {
  name: string;
  selection: string | null;
}

export interface EditorState {
  status: EditorStatus;
  /** The version edits go to: the draft, or the published scene (live). */
  version: SceneVersion;
  /** The scene's other editors, by editor id. */
  others: Record<string, EditorPresence>;
  /** The version being edited, as the editor should show it; null until it arrives. */
  doc: SceneDocument | null;
  meta: Record<string, PlacementMeta>;
  /** Whether the draft differs from what is published. */
  hasDraft: boolean;
  /** Whether edits made in this editor are still on their way to the engine. */
  unsaved: boolean;
}

export interface SceneEditorClientOptions {
  /** A fresh socket URL with its token; null when the engine cannot edit this scene. */
  open: () => Promise<string | null>;
  createSocket?: (url: string) => EditorSocket;
  onChange: (state: EditorState) => void;
  /** Which version edits go to: the draft, or the published scene (live). */
  version?: SceneVersion;
  flushMs?: number;
  /** Delay before the n-th reconnect attempt. */
  retryDelayMs?: (attempt: number) => number;
  /** How long `stop` waits for unconfirmed edits before closing anyway. */
  drainMs?: number;
}

interface Pending {
  opId: string;
  /** Made against `base`; transformed as other editors' ops arrive. */
  ops: Json0Component[];
  base: number;
}

interface VersionState {
  version: SceneVersion;
  /** The server's number this is up to. */
  seq: number;
  /** What the server confirmed, with `inflight` and `buffer` applied. */
  doc: SceneDocument;
  meta: Record<string, PlacementMeta>;
  inflight: Pending | null;
  buffer: Json0Component[] | null;
}

let opCounter = 0;
function nextOpId(): string {
  opCounter += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${opCounter}`;
}

export class SceneEditorClient {
  private socket: EditorSocket | null = null;
  private status: EditorStatus = "connecting";
  private readonly versions: Partial<Record<SceneVersion, VersionState>> = {};
  private hasDraft = false;
  private version: SceneVersion;
  /** The editor's latest document, not yet diffed and sent. */
  private desired: SceneDocument | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private stopped = false;
  /** The op id resent after a reconnect: it is not shown until the server
   *  has transformed it against what was missed. */
  private resent: string | null = null;
  private readonly flushMs: number;
  /** This editor's own presence, announced again after a reconnect. */
  private presence: EditorPresence | null = null;
  private others: Record<string, EditorPresence> = {};
  /** A publish or discard waiting for the draft's buffered edits to be sent. */
  private draftCommand: "publish" | "discard" | null = null;
  /** `unsaved` as last reported, to report only when it changes. */
  private reportedUnsaved = false;
  private readonly drainMs: number;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SceneEditorClientOptions) {
    this.version = options.version ?? "draft";
    this.flushMs = options.flushMs ?? 200;
    this.drainMs = options.drainMs ?? 5000;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  /**
   * Close the session. Edits not yet confirmed are sent first, and the
   * socket stays open (up to `drainMs`) until the engine confirms them;
   * nothing is reported after this.
   */
  stop(): void {
    this.flush();
    this.stopped = true;
    for (const timer of [this.flushTimer, this.retryTimer]) {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
    this.flushTimer = null;
    this.retryTimer = null;
    if (this.socket && this.hasUnconfirmed()) {
      this.drainTimer = setTimeout(() => this.close(), this.drainMs);
      return;
    }
    this.close();
  }

  /**
   * Whether edits made in this editor have not been confirmed by the engine:
   * not yet sent, sent and unanswered, or waiting behind those.
   */
  hasUnconfirmed(): boolean {
    if (this.desired !== null) {
      return true;
    }
    return Object.values(this.versions).some((state) => state.inflight !== null || state.buffer !== null);
  }

  /**
   * The editor changed the document it shows, read from `version`; it is
   * sent within `flushMs`. A document read from the version this is not
   * editing is dropped (see the class comment).
   */
  edit(doc: SceneDocument, version: SceneVersion): void {
    if (this.stopped || version !== this.version) {
      return;
    }
    this.desired = doc;
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushMs);
    }
  }

  /**
   * Send what the editor changed now, rather than at the next tick. While the
   * socket is down this only folds the change into what is pending, which is
   * resent on reconnect.
   */
  flush(): void {
    const state = this.versions[this.version];
    const desired = this.desired;
    if (!state || !desired) {
      // Nothing to diff against yet: kept for when there is.
      return;
    }
    this.desired = null;
    const ops = diffDocuments(state.doc, desired);
    if (ops.length === 0) {
      return;
    }
    state.doc = applyOps(state.doc, ops);
    if (state.inflight === null) {
      this.submit(state, ops);
    } else {
      state.buffer = state.buffer ? composeOps(state.buffer, ops) : ops;
    }
  }

  /** Edit the published scene (live) or the draft from now on. */
  setVersion(version: SceneVersion): void {
    this.flush();
    this.version = version;
    this.emit();
  }

  /** Make the draft what OBS shows, with every edit made before this. */
  publish(): void {
    this.draftAction("publish");
  }

  /** Tell the scene's other editors who this is and what it has selected. */
  setPresence(presence: EditorPresence): void {
    if (this.presence && this.presence.name === presence.name && this.presence.selection === presence.selection) {
      return;
    }
    this.presence = presence;
    this.send({ type: "presence", ...presence });
  }

  /** Throw the draft away, with every edit made to it before this. */
  discard(): void {
    this.draftAction("discard");
  }

  private draftAction(command: "publish" | "discard"): void {
    this.flush();
    this.draftCommand = command;
    this.sendDraftCommand();
  }

  /**
   * Sends the waiting publish or discard once nothing of the draft's is
   * buffered: the engine applies messages in order, so everything already
   * sent lands before it.
   */
  private sendDraftCommand(): void {
    const draft = this.versions.draft;
    if (this.draftCommand === null || !this.socket || this.status !== "ready" || !draft || draft.buffer !== null) {
      return;
    }
    const command = this.draftCommand;
    this.draftCommand = null;
    this.send({ type: command });
  }

  // ---------------------------------------------------------------------------

  private async connect(): Promise<void> {
    let url: string | null;
    try {
      url = await this.options.open();
    } catch {
      url = null;
      if (!this.stopped) {
        this.retry();
        return;
      }
    }
    if (this.stopped) {
      return;
    }
    if (url === null) {
      this.setStatus("unavailable");
      return;
    }
    const socket = (this.options.createSocket ?? ((u) => new WebSocket(u) as unknown as EditorSocket))(url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      this.receive(message);
    };
    socket.onclose = () => {
      if (this.socket !== socket || this.stopped) {
        return;
      }
      this.socket = null;
      // The others are told again when this reconnects; until then it cannot know.
      this.others = {};
      this.retry();
    };
  }

  private retry(): void {
    this.setStatus("reconnecting");
    const delay = this.options.retryDelayMs?.(this.attempts) ?? Math.min(500 * 2 ** this.attempts, 10_000);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private receive(message: Record<string, unknown>): void {
    const version = message.version === "published" || message.version === "draft" ? message.version : null;
    if (typeof message.hasDraft === "boolean") {
      this.hasDraft = message.hasDraft;
    }
    switch (message.type) {
      case "snapshot": {
        const snapshot = message.snapshot as SceneSnapshot | null;
        if (!version || !snapshot) {
          return;
        }
        if (version === this.version) {
          // The editor's latest goes into what is pending before it is resent.
          this.flush();
        }
        const previous = this.versions[version];
        const fresh: VersionState = {
          version,
          seq: snapshot.seq,
          doc: snapshot.doc,
          meta: snapshot.meta,
          inflight: null,
          buffer: null,
        };
        this.versions[version] = fresh;
        if (previous && (previous.inflight || previous.buffer)) {
          // Unconfirmed edits, as one op against the number they were made
          // at, keeping the in-flight op's id so the server knows it if it
          // was applied before the socket dropped.
          const inflight = previous.inflight;
          const ops = inflight
            ? previous.buffer
              ? composeOps(inflight.ops, previous.buffer)
              : inflight.ops
            : previous.buffer!;
          const pending: Pending = {
            opId: inflight && !previous.buffer ? inflight.opId : nextOpId(),
            ops,
            base: inflight ? inflight.base : previous.seq,
          };
          fresh.inflight = pending;
          this.resent = pending.opId;
          this.send({ type: "submit", version, base: pending.base, opId: pending.opId, ops });
        }
        if (this.versions.published && this.versions.draft) {
          if (this.status !== "ready" && this.presence) {
            // A new socket is a new editor to the others: announce it again.
            this.send({ type: "presence", ...this.presence });
          }
          this.setStatus("ready");
          this.sendDraftCommand();
        }
        this.emit();
        return;
      }
      case "ops":
        if (version) {
          this.receiveOps(version, message);
        }
        return;
      case "ack": {
        const state = version ? this.versions[version] : undefined;
        if (state?.inflight && state.inflight.opId === message.opId && typeof message.seq === "number") {
          // A resent op acknowledged without its ops was applied before the
          // drop, and the snapshot already shows it.
          if (this.resent === message.opId) {
            this.resent = null;
          }
          this.confirm(state, message.seq);
          this.emit();
        }
        return;
      }
      case "reject": {
        const state = version ? this.versions[version] : undefined;
        if (state?.inflight && state.inflight.opId === message.opId) {
          // What the server would not take is dropped; it sends its document
          // for a resync, and an invalid op leaves the edits since it pending.
          state.inflight = null;
          if (message.error !== "resync") {
            this.send({ type: "snapshot", version });
          }
        }
        return;
      }
      case "published":
      case "discarded":
        this.emit();
        return;
      case "presence": {
        const editorId = typeof message.editorId === "string" ? message.editorId : "";
        if (!editorId) {
          return;
        }
        const others = { ...this.others };
        if (message.left === true) {
          delete others[editorId];
        } else {
          others[editorId] = {
            name: typeof message.name === "string" ? message.name : "",
            selection: typeof message.selection === "string" ? message.selection : null,
          };
        }
        this.others = others;
        this.emit();
        return;
      }
      default:
        return;
    }
  }

  private receiveOps(version: SceneVersion, message: Record<string, unknown>): void {
    const state = this.versions[version];
    const ops = message.ops as Json0Component[];
    const seq = message.seq as number;
    if (!state || !Array.isArray(ops) || typeof seq !== "number" || seq <= state.seq) {
      return;
    }
    const meta = (message.meta ?? {}) as Record<string, PlacementMeta | null>;
    for (const [id, value] of Object.entries(meta)) {
      if (value === null) {
        delete state.meta[id];
      } else {
        state.meta[id] = value;
      }
    }
    if (state.inflight && message.opId === state.inflight.opId) {
      if (this.resent === message.opId) {
        // A resent op was not shown: show it as the server applied it, after
        // any edits buffered since, like another editor's.
        this.resent = null;
        let own = ops;
        if (state.buffer) {
          const buffer = state.buffer;
          state.buffer = transformOps(buffer, own, "left");
          own = transformOps(own, buffer, "right");
        }
        state.doc = applyOps(state.doc, own);
      }
      this.confirm(state, seq);
      this.emit();
      return;
    }
    // Someone else's change. Pending edits are sent first, so they are
    // transformed too rather than lost.
    if (version === this.version) {
      this.flush();
    }
    let remote = ops;
    if (state.inflight && this.resent !== state.inflight.opId) {
      const inflight = state.inflight.ops;
      state.inflight.ops = transformOps(inflight, remote, "left");
      remote = transformOps(remote, inflight, "right");
    }
    if (state.buffer) {
      const buffer = state.buffer;
      state.buffer = transformOps(buffer, remote, "left");
      remote = transformOps(remote, buffer, "right");
    }
    try {
      state.doc = applyOps(state.doc, remote);
    } catch {
      // Out of step with the server: start this version again from its document.
      this.send({ type: "snapshot", version });
      return;
    }
    state.seq = seq;
    this.emit();
  }

  private confirm(state: VersionState, seq: number): void {
    state.seq = Math.max(state.seq, seq);
    state.inflight = null;
    if (state.buffer) {
      const buffer = state.buffer;
      state.buffer = null;
      this.submit(state, buffer);
    }
    if (state.version === "draft") {
      this.sendDraftCommand();
    }
    if (this.stopped && !this.hasUnconfirmed()) {
      this.close();
    }
  }

  private submit(state: VersionState, ops: Json0Component[]): void {
    const pending: Pending = { opId: nextOpId(), ops, base: state.seq };
    state.inflight = pending;
    this.send({ type: "submit", version: state.version, base: pending.base, opId: pending.opId, ops });
    if (!this.reportedUnsaved) {
      this.emit();
    }
  }

  private close(): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.status = "closed";
  }

  private send(message: unknown): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // A socket closing under this send: onclose carries what was pending.
    }
  }

  private setStatus(status: EditorStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit();
    }
  }

  private emit(): void {
    if (this.stopped) {
      return;
    }
    const state = this.versions[this.version];
    this.reportedUnsaved = this.hasUnconfirmed();
    this.options.onChange({
      status: this.status,
      version: this.version,
      others: this.others,
      // `desired` is only ever the editing version's (see `edit`).
      doc: state ? (this.desired ?? state.doc) : null,
      meta: state?.meta ?? {},
      hasDraft: this.hasDraft,
      unsaved: this.reportedUnsaved,
    });
  }
}
