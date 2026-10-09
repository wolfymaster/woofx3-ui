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
 * before it, and editing on after the click never holds it back. Edits made
 * behind a command are not kept as ops: they were made on a draft the command
 * has not acted on yet. The canvas they aim for is kept instead, following
 * the others' changes as they arrive, and is diffed against the draft the
 * command leaves once the engine answers it; only then are they sent, so the
 * engine applies the command first and they stay in the draft. A socket that
 * drops before the answer diffs them against the draft this last saw instead,
 * and resends them on reconnect like any unconfirmed edit, for the engine to
 * transform over the command if it ran. The editor keeps showing that canvas
 * throughout.
 *
 * When the engine refuses an edit ahead of a command, the command is dropped
 * and reported (`onDropped`) rather than sent without it; a refused edit made
 * after a command was sent cannot affect it. `stop` keeps the session going
 * (reconnecting at once, then a few more times with a short backoff, if it
 * has to) until the edits and commands made before it are through, so leaving
 * the editor loses none of them; whatever is still waiting when that runs out
 * is reported as dropped. While it drains it shows the others no selection
 * and keeps following the server, reporting nothing. `abandon` closes at once
 * instead, for a scene that no longer exists.
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
 * What the session gave up on. `refused`: the engine refused an edit to the
 * draft made before these publishes and discards, and sent now they would act
 * on a draft without it. `undelivered`: the session closed first, with these
 * commands unsent and, when `edits` is true, edits made in this editor that
 * the engine never confirmed (some may have arrived with the answer lost).
 */
export type DroppedWork =
  | { reason: "refused"; commands: DraftCommand[] }
  | { reason: "undelivered"; commands: DraftCommand[]; edits: boolean };

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
  /**
   * How long after `stop` a new attempt to deliver what is pending may start.
   * An attempt already under way then gets to finish, for up to
   * `DRAIN_ATTEMPT_MS` (or this, if shorter) from when it began.
   */
  drainMs?: number;
  /** The session closed: stopped with nothing to wait for, drained, timed out, or abandoned. */
  onClose?: () => void;
  /** Work that will never reach the engine (see `DroppedWork`). Called after `stop` too. */
  onDropped?: (dropped: DroppedWork) => void;
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
  /** What the server confirmed, with `inflight` and the version's queued `edits` applied. */
  doc: SceneDocument;
  meta: Record<string, PlacementMeta>;
  inflight: Pending | null;
}

/** A Publish or Discard waiting to be sent. */
interface QueuedCommand {
  command: DraftCommand;
  /**
   * The canvas at the click, when edits were made behind the command ahead of
   * this one: diffed against the draft that command leaves, and confirmed,
   * before this is sent. Null when there were none.
   */
  canvas: SceneDocument | null;
}

/**
 * What goes to the engine after a version's in-flight op. Edits with no
 * command ahead of them are one composed op against `VersionState.doc`, sent
 * next. Edits behind a command (only the draft has commands) are held as the
 * canvas they aim for (see the class comment): each command's `canvas` holds
 * those made before its click, and `canvas` here those made after the last.
 */
interface Outbox {
  edits: Json0Component[] | null;
  commands: QueuedCommand[];
  canvas: SceneDocument | null;
}

/**
 * The waits between reconnects while draining, one per attempt. A drain has
 * only `drainMs` to start its attempts and the usual backoff can outlast it,
 * but a short fixed wait would hammer an engine that is down. These fit four
 * attempts (after the one `stop` makes at once) into the default five
 * seconds; after the last the drain gives up.
 */
const DRAIN_RETRY_DELAYS_MS = [250, 500, 1000, 2000];

/**
 * How long a drain's attempt may take, from asking for a session to having
 * delivered, when the drain's deadline passes while it is under way. Opening
 * a session takes two Convex actions, so an attempt begun near the deadline
 * would otherwise be cut off before it could deliver anything.
 */
const DRAIN_ATTEMPT_MS = 3000;

let opCounter = 0;
function nextOpId(): string {
  opCounter += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${opCounter}`;
}

function emptyOutbox(): Outbox {
  return { edits: null, commands: [], canvas: null };
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
  /** Each version's outgoing edits and commands (see `Outbox`). Kept across reconnects. */
  private readonly outboxes: Record<SceneVersion, Outbox> = { draft: emptyOutbox(), published: emptyOutbox() };
  /**
   * The Publish or Discard sent on this socket and not yet answered. Nothing
   * more of the draft's is sent until it is: edits behind it are diffed
   * against the draft it leaves.
   */
  private sentCommand: DraftCommand | null = null;
  /** Reconnects made while draining, bounded by `DRAIN_RETRY_DELAYS_MS`. */
  private drainRetries = 0;
  /** `unsaved` as last reported, to report only when it changes. */
  private reportedUnsaved = false;
  private readonly drainMs: number;
  /** While draining: when the drain stops starting attempts (see `drainMs`). */
  private drainDeadline = 0;
  /** When the current connection attempt began: its `connect`, or `stop` for the socket it found. */
  private attemptStartedAt = 0;
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
   * yet sent, go first: the session stays open, and reconnects if its socket
   * drops, until they are through or no attempt is left (see `drainMs`). An
   * engine that would not open a session ("unavailable") closes it at once.
   * Nothing is reported after this.
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
    this.attemptStartedAt = Date.now();
    this.drainDeadline = this.attemptStartedAt + this.drainMs;
    this.drainTimer = setTimeout(() => this.endDrainAttempts(), this.drainMs);
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
    this.forgetPending();
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
    return Object.values(this.outboxes).some(
      (outbox) =>
        outbox.edits !== null || outbox.canvas !== null || outbox.commands.some((queued) => queued.canvas !== null)
    );
  }

  /**
   * Whether anything asked of this has not reached the engine: unconfirmed
   * edits, or a Publish or Discard not yet sent. What `stop` waits for.
   */
  hasPending(): boolean {
    return this.hasUnconfirmed() || this.outboxes.draft.commands.length > 0;
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
    if (this.behindCommand(state.version)) {
      this.outboxes[state.version].canvas = desired;
      if (!this.reportedUnsaved) {
        this.emit();
      }
      return;
    }
    if (!this.queueEdits(state, diffDocuments(state.doc, desired))) {
      if (this.reportedUnsaved !== this.hasUnconfirmed()) {
        this.emit();
      }
      return;
    }
    this.advance(state.version);
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
    const outbox = this.outboxes.draft;
    outbox.commands.push({ command, canvas: outbox.canvas });
    outbox.canvas = null;
    this.advance("draft");
  }

  /** Whether a version's new edits go behind a Publish or Discard (see `Outbox`). */
  private behindCommand(version: SceneVersion): boolean {
    return this.outboxes[version].commands.length > 0 || (version === "draft" && this.sentCommand !== null);
  }

  /** Applies edits to what this shows and queues them to be sent; false when there are none. */
  private queueEdits(state: VersionState, ops: Json0Component[]): boolean {
    if (ops.length === 0) {
      return false;
    }
    state.doc = applyOps(state.doc, ops);
    const outbox = this.outboxes[state.version];
    outbox.edits = outbox.edits ? composeOps(outbox.edits, ops) : ops;
    return true;
  }

  /**
   * Sends what is next for a version while nothing of its is in flight: its
   * queued edits, or else the draft's next command, which is then waited for
   * like an edit. Commands also wait for a socket with both snapshots.
   * Sending one while an edit ahead of it is in flight would act without that
   * edit if the engine refused it.
   */
  private advance(version: SceneVersion): void {
    const state = this.versions[version];
    const outbox = this.outboxes[version];
    if (state && state.inflight === null && !(version === "draft" && this.sentCommand !== null)) {
      const next = outbox.commands[0];
      if (outbox.edits !== null) {
        const ops = outbox.edits;
        outbox.edits = null;
        this.submit(state, ops);
      } else if (next && this.socket && this.synced.has("published") && this.synced.has("draft")) {
        outbox.commands.shift();
        this.sentCommand = next.command;
        this.send({ type: next.command });
      }
    }
    this.closeIfDrained();
  }

  /**
   * The command sent was answered, or its socket dropped, which leaves the
   * server alone knowing whether it ran. The edits made behind it are diffed
   * against the draft as this now has it, and go next: after an answer that
   * is the draft the command left; after a drop, the draft before it, and the
   * resend on reconnect has the server transform them over it if it ran.
   */
  private settleSentCommand(): void {
    this.sentCommand = null;
    const state = this.versions.draft;
    const outbox = this.outboxes.draft;
    const head = outbox.commands[0];
    const canvas = head ? head.canvas : outbox.canvas;
    if (state && canvas) {
      if (head) {
        head.canvas = null;
      } else {
        outbox.canvas = null;
      }
      this.queueEdits(state, diffDocuments(state.doc, canvas));
    }
    this.advance("draft");
  }

  /** The canvas of the latest edits held behind a command, if any (see `Outbox`). */
  private latestCanvas(version: SceneVersion): SceneDocument | null {
    const outbox = this.outboxes[version];
    if (outbox.canvas) {
      return outbox.canvas;
    }
    for (const queued of [...outbox.commands].reverse()) {
      if (queued.canvas) {
        return queued.canvas;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------

  private async connect(): Promise<void> {
    this.attemptStartedAt = Date.now();
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
      if (this.sentCommand !== null) {
        // Its answer would have come on this socket.
        this.settleSentCommand();
        if (!this.active) {
          // That was all a drain was waiting for, and it has closed.
          return;
        }
      }
      this.retry();
    };
  }

  private retry(): void {
    this.setStatus("reconnecting");
    const backoff = this.options.retryDelayMs?.(this.attempts) ?? Math.min(500 * 2 ** this.attempts, 10_000);
    let delay = backoff;
    if (this.draining) {
      const drainDelay = DRAIN_RETRY_DELAYS_MS[this.drainRetries];
      delay = Math.min(backoff, drainDelay ?? 0);
      if (drainDelay === undefined || Date.now() + delay >= this.drainDeadline) {
        this.close();
        return;
      }
      this.drainRetries += 1;
    }
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  /**
   * The drain's deadline: no attempt starts after it. One already under way
   * gets until `DRAIN_ATTEMPT_MS` from its start to deliver.
   */
  private endDrainAttempts(): void {
    this.drainTimer = null;
    const left = this.attemptStartedAt + Math.min(DRAIN_ATTEMPT_MS, this.drainMs) - Date.now();
    if (this.retryTimer !== null || left <= 0) {
      this.close();
      return;
    }
    this.drainTimer = setTimeout(() => this.close(), left);
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
        // The queued edits (those ahead of any command) go out with the
        // in-flight op. Edits held behind a command wait for it, as canvases
        // diffed against the server's draft when they go.
        const outbox = this.outboxes[version];
        const queued = outbox.edits;
        outbox.edits = null;
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
            this.dropCommandsBehindRefusal(state);
          }
          this.closeIfDrained();
        }
        return;
      }
      case "published":
      case "discarded":
        if (this.sentCommand === (message.type === "published" ? "publish" : "discard")) {
          this.settleSentCommand();
        }
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

  /**
   * The engine refused an edit to the draft. It is gone for good, and every
   * queued command was asked for after it was made: sent now, a publish would
   * put the draft on stream without it. The commands are dropped and
   * reported; the edits held behind them stay, as edits against the draft
   * this shows, sent with the resync.
   */
  private dropCommandsBehindRefusal(state: VersionState): void {
    const outbox = this.outboxes.draft;
    const commands = outbox.commands.map((queued) => queued.command);
    if (commands.length === 0) {
      return;
    }
    const latest = this.latestCanvas("draft");
    outbox.commands.length = 0;
    outbox.canvas = null;
    if (latest) {
      this.queueEdits(state, diffDocuments(state.doc, latest));
    }
    this.options.onDropped?.({ reason: "refused", commands });
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
        // any edits queued since, like another editor's. Canvases held behind
        // a command were drawn with it already, and are left as they are.
        this.resent = null;
        const own = this.transformEdits(version, ops);
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
    remote = this.transformEdits(version, remote);
    const before = state.doc;
    try {
      state.doc = applyOps(state.doc, remote);
    } catch {
      // Out of step with the server: start this version again from its document.
      this.send({ type: "snapshot", version });
      return;
    }
    this.rebaseCanvases(version, before, remote);
    state.seq = seq;
    this.emit();
  }

  /**
   * Transforms a version's queued edits against an op the server applied
   * before them, and returns that op as it applies after them.
   */
  private transformEdits(version: SceneVersion, applied: Json0Component[]): Json0Component[] {
    const outbox = this.outboxes[version];
    const edits = outbox.edits;
    if (edits === null) {
      return applied;
    }
    outbox.edits = transformOps(edits, applied, "left");
    return transformOps(applied, edits, "right");
  }

  /**
   * Carries another editor's change, `remote` as applied to `before`, into
   * the canvases held behind a command, so that diffing one against the draft
   * later does not undo it. Each keeps its own changes from `before`.
   */
  private rebaseCanvases(version: SceneVersion, before: SceneDocument, remote: Json0Component[]): void {
    const state = this.versions[version];
    const outbox = this.outboxes[version];
    if (!state) {
      return;
    }
    const rebase = (canvas: SceneDocument): SceneDocument => {
      try {
        return applyOps(state.doc, transformOps(diffDocuments(before, canvas), remote, "left"));
      } catch {
        // Kept as drawn: diffed later, it overrides the change where they meet.
        return canvas;
      }
    };
    for (const queued of outbox.commands) {
      if (queued.canvas) {
        queued.canvas = rebase(queued.canvas);
      }
    }
    if (outbox.canvas) {
      outbox.canvas = rebase(outbox.canvas);
    }
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

  /** Forgets every edit and command not yet through, sending none of them. */
  private forgetPending(): void {
    this.desired = null;
    this.sentCommand = null;
    for (const state of Object.values(this.versions)) {
      state.inflight = null;
    }
    for (const outbox of Object.values(this.outboxes)) {
      outbox.edits = null;
      outbox.commands.length = 0;
      outbox.canvas = null;
    }
  }

  private close(): void {
    // Closing on purpose (`abandon`) forgets what is pending first; whatever
    // is left here was given up on: the drain ran out, or the engine would
    // not open a session.
    const commands = this.outboxes.draft.commands.map((queued) => queued.command);
    const edits = this.hasUnconfirmed();
    this.forgetPending();
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
    if (commands.length > 0 || edits) {
      this.options.onDropped?.({ reason: "undelivered", commands, edits });
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
      doc: state ? (this.desired ?? this.latestCanvas(this.version) ?? state.doc) : null,
      meta: state?.meta ?? {},
      hasDraft: this.hasDraft,
      unsaved: this.reportedUnsaved,
    });
  }
}
