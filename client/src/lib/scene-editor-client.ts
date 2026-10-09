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
 * one read from the published scene would undo the draft's own edits. An
 * edit made before this client has seen any snapshot of its version is
 * dropped too: that canvas came from somewhere else (an earlier client, or
 * the cached scene), and diffing it against the snapshot would undo whatever
 * changed since. Once a version is loaded its edits are kept across
 * reconnects, folded into what is pending and resent.
 *
 * `publish` and `discard` take their place in the draft's outgoing queue,
 * between the edits made before the click and those made after it. Each is
 * sent once the engine has confirmed every edit ahead of it (after a
 * reconnect, the resent ones too), so a publish includes the last change made
 * before it; edits made after it are held until it is sent, so the engine
 * applies it first and they stay in the draft. Editing on after the click
 * therefore never holds a command back. When the engine refuses an edit ahead
 * of a command, the command is dropped and reported (`onDraftCommandsDropped`)
 * rather than sent without it; a refused edit made after a command was sent
 * cannot affect it. `stop` keeps the session going (reconnecting at once, then
 * a few more times with a short backoff, if it has to) until the edits and
 * commands made before it are through, so leaving the editor loses none of
 * them; a command still waiting when that runs out is reported as dropped.
 * While it drains it shows the others no selection and keeps following the
 * server, reporting nothing. `abandon` closes at once instead, for a scene
 * that no longer exists.
 */

/** The slice of a WebSocket this uses (injectable for tests). */
export interface EditorSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type DraftCommand = "publish" | "discard";

/**
 * Why a Publish or Discard was dropped: the engine refused an edit made before
 * it, or the session closed before it could be sent.
 */
export type DraftCommandDropReason = "refused" | "undelivered";

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
  /** The session closed: stopped with nothing to wait for, drained, timed out, or abandoned. */
  onClose?: () => void;
  /**
   * Publishes and discards that will never be sent, oldest first: the engine
   * refused an edit to the draft made before them (sent now, they would act on
   * a draft without it), or the session closed first. Called after `stop` too.
   */
  onDraftCommandsDropped?: (commands: DraftCommand[], reason: DraftCommandDropReason) => void;
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
  /** What the server confirmed, with `inflight` and the version's queued edits applied. */
  doc: SceneDocument;
  meta: Record<string, PlacementMeta>;
  inflight: Pending | null;
}

/**
 * What goes to the engine after a version's in-flight op, in order: edits not
 * yet sent, and the draft's publishes and discards. Consecutive edits are kept
 * composed into one entry, and new edits compose into the last entry when it
 * is an edit, so a command always separates the edits made before it from
 * those made after.
 */
type Outgoing = Json0Component[] | DraftCommand;

function isOps(entry: Outgoing): entry is Json0Component[] {
  return Array.isArray(entry);
}

/**
 * The waits between reconnects while draining, one per attempt. A drain has
 * only `drainMs` to deliver and the usual backoff can outlast it, but a short
 * fixed wait would hammer an engine that is down. These fit four attempts
 * (after the one `stop` makes at once) into the default five seconds; after
 * the last the drain gives up.
 */
const DRAIN_RETRY_DELAYS_MS = [250, 500, 1000, 2000];

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
  /** Nothing is reported or accepted from the editor after `stop`. */
  private stopped = false;
  /** Stopped, but still finishing what was asked before `stop` (see `stop`). */
  private draining = false;
  /** The versions whose snapshot this socket has delivered; both are needed before anything is sent for the draft. */
  private readonly synced = new Set<SceneVersion>();
  /** The op id resent after a reconnect: it is not shown until the server
   *  has transformed it against what was missed. */
  private resent: string | null = null;
  private readonly flushMs: number;
  /** This editor's own presence, announced again after a reconnect. */
  private presence: EditorPresence | null = null;
  private others: Record<string, EditorPresence> = {};
  /** Each version's outgoing queue (see `Outgoing`). Kept across reconnects; edits only once its snapshot is loaded. */
  private readonly queues: Record<SceneVersion, Outgoing[]> = { draft: [], published: [] };
  /** Reconnects made while draining, bounded by `DRAIN_RETRY_DELAYS_MS`. */
  private drainRetries = 0;
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
   * Close the session. Edits not yet confirmed, and publishes or discards not
   * yet sent, go first: for up to `drainMs` the session stays open, and
   * reconnects if its socket drops, until they are through. An engine that
   * would not open a session ("unavailable") closes it at once. Nothing is
   * reported after this.
   */
  stop(): void {
    if (this.stopped) {
      return;
    }
    this.flush();
    this.stopped = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // "unavailable" is the engine declining to open a session at all, and
    // nothing retries from there: there is nothing to wait for.
    if (!this.hasPending() || this.status === "unavailable") {
      this.close();
      return;
    }
    this.draining = true;
    this.drainRetries = 0;
    this.drainTimer = setTimeout(() => this.close(), this.drainMs);
    if (this.retryTimer !== null) {
      // The backoff may run past the drain: reconnect now instead.
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      void this.connect();
    }
    // The protocol has no leave short of closing, and a new editor for this
    // scene may already be open: an empty selection keeps this one off the
    // others' canvases meanwhile.
    if (this.presence?.selection) {
      this.presence = { name: this.presence.name, selection: null };
      this.send({ type: "presence", ...this.presence });
    }
  }

  /**
   * Close the session now, dropping whatever `stop` would have waited for:
   * for a scene that was deleted, where resending to it can only fail.
   */
  abandon(): void {
    this.stopped = true;
    this.desired = null;
    this.queues.draft.length = 0;
    this.queues.published.length = 0;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
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
    if (Object.values(this.versions).some((state) => state.inflight !== null)) {
      return true;
    }
    return this.queues.draft.some(isOps) || this.queues.published.some(isOps);
  }

  /** Whether this is still delivering, after `stop`, what was asked before it. */
  isDraining(): boolean {
    return this.draining;
  }

  /**
   * Whether anything asked of this has not reached the engine: unconfirmed
   * edits, or a Publish or Discard not yet sent. What `stop` waits for.
   */
  hasPending(): boolean {
    return this.hasUnconfirmed() || this.queues.draft.some((entry) => !isOps(entry));
  }

  /** Whether the session is still connecting and processing: running, or draining after `stop`. */
  private get active(): boolean {
    return !this.stopped || this.draining;
  }

  /**
   * The editor changed the document it shows, read from `version`; it is
   * sent within `flushMs`. A document read from the version this is not
   * editing, or from one this has no snapshot of yet, is dropped (see the
   * class comment).
   */
  edit(doc: SceneDocument, version: SceneVersion): void {
    if (this.stopped || version !== this.version || !this.versions[version]) {
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
      return;
    }
    this.desired = null;
    const ops = diffDocuments(state.doc, desired);
    if (ops.length === 0) {
      if (this.reportedUnsaved !== this.hasUnconfirmed()) {
        this.emit();
      }
      return;
    }
    state.doc = applyOps(state.doc, ops);
    const queue = this.queues[state.version];
    const last = queue.at(-1);
    if (state.inflight === null && last === undefined) {
      this.submit(state, ops);
    } else if (last !== undefined && isOps(last)) {
      queue[queue.length - 1] = composeOps(last, ops);
    } else {
      queue.push(ops);
    }
  }

  /** Edit the published scene (live) or the draft from now on. */
  setVersion(version: SceneVersion): void {
    if (version === this.version) {
      return;
    }
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

  private draftAction(command: DraftCommand): void {
    if (this.stopped) {
      return;
    }
    // The edits made before the click go ahead of it; any made after queue behind it.
    this.flush();
    this.queues.draft.push(command);
    this.advance("draft");
  }

  /**
   * Sends what is next in a version's queue while nothing of its is in
   * flight: commands at the head go out as they come, and the next edit is
   * submitted and waited for. Commands wait for a socket with both
   * snapshots. Sending one while an edit ahead of it is in flight would act
   * without that edit if the engine refused it.
   */
  private advance(version: SceneVersion): void {
    const state = this.versions[version];
    const queue = this.queues[version];
    for (let next = queue[0]; state && state.inflight === null && next !== undefined; next = queue[0]) {
      if (isOps(next)) {
        queue.shift();
        this.submit(state, next);
        break;
      }
      if (!this.socket || !this.synced.has("published") || !this.synced.has("draft")) {
        break;
      }
      queue.shift();
      this.send({ type: next });
    }
    this.closeIfDrained();
  }

  // ---------------------------------------------------------------------------

  private async connect(): Promise<void> {
    let url: string | null;
    try {
      url = await this.options.open();
    } catch {
      url = null;
      if (this.active) {
        this.retry();
        return;
      }
    }
    if (!this.active) {
      return;
    }
    if (url === null) {
      this.setStatus("unavailable");
      if (this.draining) {
        this.close();
      }
      return;
    }
    const socket = (this.options.createSocket ?? ((u) => new WebSocket(u) as unknown as EditorSocket))(url);
    this.socket = socket;
    this.synced.clear();
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
      if (this.socket !== socket || !this.active) {
        return;
      }
      this.socket = null;
      this.synced.clear();
      // The others are told again when this reconnects; until then it cannot know.
      this.others = {};
      this.retry();
    };
  }

  private retry(): void {
    this.setStatus("reconnecting");
    const backoff = this.options.retryDelayMs?.(this.attempts) ?? Math.min(500 * 2 ** this.attempts, 10_000);
    let delay = backoff;
    if (this.draining) {
      const drainDelay = DRAIN_RETRY_DELAYS_MS[this.drainRetries];
      if (drainDelay === undefined) {
        this.close();
        return;
      }
      this.drainRetries += 1;
      delay = Math.min(backoff, drainDelay);
    }
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
        this.synced.add(version);
        const fresh: VersionState = {
          version,
          seq: snapshot.seq,
          doc: snapshot.doc,
          meta: snapshot.meta,
          inflight: null,
        };
        this.versions[version] = fresh;
        // The edits queued ahead of any command go out with the in-flight op.
        const queue = this.queues[version];
        let queued: Json0Component[] | null = null;
        for (let next = queue[0]; next !== undefined && isOps(next); next = queue[0]) {
          queue.shift();
          queued = queued ? composeOps(queued, next) : next;
        }
        const inflight = previous?.inflight ?? null;
        const ops = inflight && queued ? composeOps(inflight.ops, queued) : (inflight?.ops ?? queued);
        if (previous && ops) {
          // Unconfirmed edits, as one op against the number they were made
          // at, keeping the in-flight op's id so the server knows it if it
          // was applied before the socket dropped.
          const pending: Pending = {
            opId: inflight && !queued ? inflight.opId : nextOpId(),
            ops,
            base: inflight ? inflight.base : previous.seq,
          };
          fresh.inflight = pending;
          this.resent = pending.opId;
          this.send({ type: "submit", version, base: pending.base, opId: pending.opId, ops });
        }
        if (this.synced.has("published") && this.synced.has("draft")) {
          if (this.status !== "ready" && this.presence && !this.stopped) {
            // A new socket is a new editor to the others: announce it again.
            this.send({ type: "presence", ...this.presence });
          }
          this.setStatus("ready");
          this.advance("draft");
        }
        this.closeIfDrained();
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
          if (state.version === "draft") {
            // The refused edit is gone for good, and every queued command was
            // asked for after it was made: sent now, a publish would put the
            // draft on stream without it.
            const dropped = this.dropDraftCommands();
            if (dropped.length > 0) {
              this.options.onDraftCommandsDropped?.(dropped, "refused");
            }
          }
          this.closeIfDrained();
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
        const own = this.transformQueue(version, ops);
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
    remote = this.transformQueue(version, remote);
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

  /**
   * Transforms the queued edits of a version against an op the server
   * applied before them, and returns that op as it applies after them.
   */
  private transformQueue(version: SceneVersion, applied: Json0Component[]): Json0Component[] {
    const queue = this.queues[version];
    let op = applied;
    for (const [index, entry] of queue.entries()) {
      if (isOps(entry)) {
        queue[index] = transformOps(entry, op, "left");
        op = transformOps(op, entry, "right");
      }
    }
    return op;
  }

  /** Removes the draft's queued commands, keeping its queued edits (composed), and returns the commands. */
  private dropDraftCommands(): DraftCommand[] {
    const queue = this.queues.draft;
    const commands = queue.filter((entry): entry is DraftCommand => !isOps(entry));
    if (commands.length === 0) {
      return commands;
    }
    const edits = queue.filter(isOps);
    queue.length = 0;
    if (edits.length > 0) {
      queue.push(edits.reduce((composed, next) => composeOps(composed, next)));
    }
    return commands;
  }

  private confirm(state: VersionState, seq: number): void {
    state.seq = Math.max(state.seq, seq);
    state.inflight = null;
    this.advance(state.version);
  }

  private closeIfDrained(): void {
    if (this.draining && !this.hasPending()) {
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
    // Closing on purpose (`abandon`) empties the queues first; whatever is
    // left here was given up on: the drain ran out, or the engine would not
    // open a session.
    const undelivered = this.dropDraftCommands();
    this.draining = false;
    for (const timer of [this.drainTimer, this.retryTimer]) {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
    this.drainTimer = null;
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
    this.status = "closed";
    if (undelivered.length > 0) {
      this.options.onDraftCommandsDropped?.(undelivered, "undelivered");
    }
    this.options.onClose?.();
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
