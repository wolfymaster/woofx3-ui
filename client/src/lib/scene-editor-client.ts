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
 * Publish and Discard: one at a time, and the draft is read-only from the
 * click until the engine answers (`EditorState.command`; draft edits are
 * dropped meanwhile). The command is sent once the engine has confirmed every
 * edit made before the click, after a reconnect the resent ones too, so a
 * publish includes the last change made before it; with the draft locked
 * there is nothing made after it to order. The engine's answer settles it:
 * `published` or `discarded`, or an `error` naming the command, reported as
 * a failure. An `error` naming a submit is that op's refusal. An engine that
 * names neither leaves the error to be attributed by what is in flight, so
 * nothing else that could fail is in flight while the command is: it also
 * waits for the published scene's in-flight edit, and live edits made while
 * it is pending are held (and shown) until the answer, as is a resend of
 * them after a resync. A socket that drops after the command was sent and
 * before its answer leaves only the engine knowing whether it ran: it is not
 * sent again but reported as uncertain, and editing unlocks. One still
 * waiting to be sent when the socket drops is sent after the reconnect. An
 * edit made before the click that the engine refuses drops the command
 * (reported), rather than publishing a draft without it. Neither is taken
 * while the engine will not open a session or the scene is gone.
 *
 * A scene the engine does not have (`error` `not_found` on open) is gone:
 * whatever is pending is reported as such and dropped, and this stops
 * reconnecting (status `gone`).
 *
 * `stop` keeps the session going (reconnecting at once, then a few more times
 * with a short backoff, if it has to) until the edits made before it are
 * confirmed and any Publish or Discard is answered, so leaving the editor
 * loses none of them; whatever is still waiting when that runs out is
 * reported. A command already sent on an open socket is waited on longer
 * (`commandAnswerMs`): the engine has it, and only its answer says whether
 * it ran. While it drains it shows the others no selection and keeps
 * following the server, reporting nothing but those reports. `abandon` closes
 * at once instead, for a scene that no longer exists.
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
 * A Publish or Discard, or edits, that did not go through, or may not have.
 * `failed`: the engine answered the command with an error. `refused`: the
 * engine refused an edit made before the command, which was then not sent.
 * `uncertain`: the command was sent and the connection was lost before the
 * answer; it may have run. `undelivered`: the session closed first, with this
 * command not yet sent and, when `edits` is true, edits made in this editor
 * that the engine never confirmed (some may have arrived with the answer lost).
 * `gone`: the engine no longer has the scene; this command, and these edits
 * when `edits` is true, were dropped with it.
 */
export type DroppedWork =
  | { reason: "failed" | "refused" | "uncertain"; command: DraftCommand }
  | { reason: "undelivered"; command: DraftCommand | null; edits: boolean }
  | { reason: "gone"; command: DraftCommand | null; edits: boolean };

export type EditorStatus = "connecting" | "ready" | "reconnecting" | "unavailable" | "gone" | "closed";

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
  /** The Publish or Discard waiting for the engine's answer; the draft is read-only meanwhile. */
  command: DraftCommand | null;
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
  /**
   * How long after `stop` a drain keeps waiting for the answer to a Publish
   * or Discard it sent on a socket that is still open, past `drainMs`.
   */
  commandAnswerMs?: number;
  /** The session closed: stopped with nothing to wait for, drained, timed out, or abandoned. */
  onClose?: () => void;
  /** See `DroppedWork`. Called after `stop` too, while the session drains. */
  onDropped?: (dropped: DroppedWork) => void;
  /**
   * The Publish or Discard waiting for its answer changed. Called after
   * `stop` too, unlike `onChange`, so a draining session's command can lock
   * the scene's draft in another editor.
   */
  onCommandChange?: (command: DraftCommand | null) => void;
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
  /** Edits made since `inflight` was sent, composed into one op; sent once it is confirmed. */
  buffer: Json0Component[] | null;
  /**
   * The server refused the in-flight op and its snapshot is on the way. The
   * buffer was made on top of the refused op, so it waits to be resent with
   * the snapshot rather than sent on its own.
   */
  resyncing: boolean;
  /**
   * `inflight` is unconfirmed edits resent after a reconnect or resync. It is
   * not shown until the server has transformed it against what was missed.
   */
  resent: boolean;
  /**
   * `inflight` is such a resend that a Publish or Discard holds (see
   * `advance`): not sent yet, it goes once the command is answered.
   */
  resendHeld: boolean;
}

interface PendingCommand {
  command: DraftCommand;
  /** Sent on the current socket, and waiting for its answer. */
  sent: boolean;
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

/** The default `commandAnswerMs`. */
const COMMAND_ANSWER_MS = 15_000;

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
  /** The versions whose snapshot this socket has delivered; both are needed before a command is sent. */
  private readonly synced = new Set<SceneVersion>();
  private readonly flushMs: number;
  /** This editor's own presence, announced again after a reconnect. */
  private presence: EditorPresence | null = null;
  private others: Record<string, EditorPresence> = {};
  /** The Publish or Discard not yet answered (see the class comment). */
  private command: PendingCommand | null = null;
  /** Reconnects made while draining, bounded by `DRAIN_RETRY_DELAYS_MS`. */
  private drainRetries = 0;
  /** `unsaved` as last reported, to report only when it changes. */
  private reportedUnsaved = false;
  private readonly drainMs: number;
  private readonly commandAnswerMs: number;
  /** While draining: when `stop` began it. */
  private drainStartedAt = 0;
  /** While draining: when the drain stops starting attempts (see `drainMs`). */
  private drainDeadline = 0;
  /** When the current connection attempt began: its `connect`, or `stop` for the socket it found. */
  private attemptStartedAt = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SceneEditorClientOptions) {
    this.version = options.version ?? "draft";
    this.flushMs = options.flushMs ?? 200;
    this.drainMs = options.drainMs ?? 5000;
    this.commandAnswerMs = options.commandAnswerMs ?? COMMAND_ANSWER_MS;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  /**
   * Close the session. Edits not yet confirmed, and a Publish or Discard not
   * yet answered, go first: the session stays open, and reconnects if its
   * socket drops, until they are through or no attempt is left (see
   * `drainMs`). An engine that would not open a session ("unavailable")
   * closes it at once. Only `onDropped` and `onClose` are called after this.
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
    // nothing retries from there or from "gone": there is nothing to wait for.
    if (!this.hasPending() || this.status === "unavailable" || this.status === "gone") {
      this.close();
      return;
    }
    this.draining = true;
    this.drainRetries = 0;
    this.drainStartedAt = Date.now();
    this.attemptStartedAt = this.drainStartedAt;
    this.drainDeadline = this.drainStartedAt + this.drainMs;
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
    return Object.values(this.versions).some((state) => state.inflight !== null || state.buffer !== null);
  }

  /**
   * Whether anything asked of this is not through: unconfirmed edits, or a
   * Publish or Discard not yet answered. What `stop` waits for.
   */
  hasPending(): boolean {
    return this.hasUnconfirmed() || this.command !== null;
  }

  /** The Publish or Discard waiting for the engine's answer. */
  pendingCommand(): DraftCommand | null {
    return this.command?.command ?? null;
  }

  /** Whether the session is still connecting and processing: running, or draining after `stop`. */
  private get active(): boolean {
    return !this.stopped || this.draining;
  }

  /**
   * The editor changed the document it shows, read from `version`; it is
   * sent within `flushMs`. A document read from the version this is not
   * editing, or from one this has no snapshot of yet, is dropped (see the
   * class comment), as is one of the draft while a Publish or Discard waits,
   * and every one once the scene is gone. Returns whether it was taken: the
   * editor shows the session's document again for one that was not.
   */
  edit(doc: SceneDocument, version: SceneVersion): boolean {
    if (
      this.stopped ||
      this.status === "gone" ||
      version !== this.version ||
      !this.versions[version] ||
      this.draftLocked(version)
    ) {
      return false;
    }
    this.desired = doc;
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushMs);
    }
    return true;
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
    state.buffer = state.buffer ? composeOps(state.buffer, ops) : ops;
    this.advance();
    if (!this.reportedUnsaved) {
      this.emit();
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

  /** Make the draft what OBS shows, with every edit made before this. Returns whether it was taken (see `draftAction`). */
  publish(): boolean {
    return this.draftAction("publish");
  }

  /** Tell the scene's other editors who this is and what it has selected. */
  setPresence(presence: EditorPresence): void {
    if (this.presence && this.presence.name === presence.name && this.presence.selection === presence.selection) {
      return;
    }
    this.presence = presence;
    this.send({ type: "presence", ...presence });
  }

  /** Throw the draft away, with every edit made to it before this. Returns whether it was taken (see `draftAction`). */
  discard(): boolean {
    return this.draftAction("discard");
  }

  /**
   * Takes the command unless one already waits (the draft it would act on is
   * locked), or no session can carry it: the engine would not open one, or
   * the scene is gone. Returns whether it was taken.
   */
  private draftAction(command: DraftCommand): boolean {
    if (this.stopped || this.command !== null || this.status === "unavailable" || this.status === "gone") {
      return false;
    }
    // The edit made just before the click is one the command covers.
    this.flush();
    this.setCommand({ command, sent: false });
    this.emit();
    this.advance();
    return true;
  }

  private setCommand(command: PendingCommand | null): void {
    const changed = (this.command?.command ?? null) !== (command?.command ?? null);
    this.command = command;
    if (changed) {
      this.options.onCommandChange?.(command?.command ?? null);
    }
  }

  /** Whether edits to `version` are refused: the draft while a Publish or Discard waits. */
  private draftLocked(version: SceneVersion): boolean {
    return version === "draft" && this.command !== null;
  }

  /**
   * Sends what can go now. Each version's buffered edits go once nothing of
   * its is in flight, except while a command holds them: the draft's are
   * edits made before the click and go until the command is sent; the
   * published scene's wait for the answer (see the class comment). The
   * command goes once nothing it waits for is left.
   */
  private advance(): void {
    for (const state of Object.values(this.versions)) {
      if (this.heldByCommand(state.version)) {
        continue;
      }
      if (state.resendHeld && state.inflight) {
        state.resendHeld = false;
        this.sendSubmit(state.version, state.inflight);
        continue;
      }
      if (state.inflight === null && state.buffer !== null && !state.resyncing) {
        const ops = state.buffer;
        state.buffer = null;
        this.submit(state, ops);
      }
    }
    this.sendCommandIfReady();
    this.closeIfDrained();
  }

  /** Whether a waiting command keeps `version`'s edits from being sent (see `advance`). */
  private heldByCommand(version: SceneVersion): boolean {
    return this.command !== null && (version === "published" || this.command.sent);
  }

  /**
   * Sends the waiting command once this socket has both snapshots and the
   * engine has confirmed every edit made before the click, and nothing else
   * that could fail is in flight (see the class comment).
   */
  private sendCommandIfReady(): void {
    const command = this.command;
    if (!command || command.sent || !this.socket || !this.synced.has("published") || !this.synced.has("draft")) {
      return;
    }
    const { draft, published } = this.versions;
    // A held resend is not in flight: it waits for this command's answer.
    if (draft?.inflight || draft?.buffer || (published?.inflight && !published.resendHeld)) {
      return;
    }
    command.sent = true;
    this.send({ type: command.command });
  }

  /** The waiting command is over; editing the draft unlocks, and what it held goes. */
  private settleCommand(report: DroppedWork | null): void {
    this.setCommand(null);
    if (report) {
      this.options.onDropped?.(report);
    }
    this.advance();
    this.emit();
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
    if (!this.active || this.status === "gone") {
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
      if (this.command?.sent) {
        // Its answer would have come on this socket. Sent again, a command
        // that did run would run twice (a second Discard after edits on
        // another editor), so the streamer is told to check instead.
        this.settleCommand({ reason: "uncertain", command: this.command.command });
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
   * gets until `DRAIN_ATTEMPT_MS` from its start to deliver. A command sent
   * on the open socket gets until `commandAnswerMs` from `stop` for its
   * answer, however the attempt that sent it is doing: the engine has it.
   */
  private endDrainAttempts(): void {
    this.drainTimer = null;
    const now = Date.now();
    if (this.command?.sent && this.socket !== null) {
      const answerLeft = this.drainStartedAt + Math.max(this.commandAnswerMs, this.drainMs) - now;
      if (answerLeft > 0) {
        this.drainTimer = setTimeout(() => this.close(), answerLeft);
        return;
      }
    }
    const left = this.attemptStartedAt + Math.min(DRAIN_ATTEMPT_MS, this.drainMs) - now;
    if (this.retryTimer !== null || left <= 0) {
      this.close();
      return;
    }
    this.drainTimer = setTimeout(() => this.endDrainAttempts(), left);
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
          buffer: null,
          resyncing: false,
          resent: false,
          resendHeld: false,
        };
        this.versions[version] = fresh;
        const inflight = previous?.inflight ?? null;
        const buffer = previous?.buffer ?? null;
        const ops = inflight && buffer ? composeOps(inflight.ops, buffer) : (inflight?.ops ?? buffer);
        if (previous && ops) {
          // Unconfirmed edits, as one op against the number they were made
          // at, keeping the in-flight op's id so the server knows it if it
          // was applied before the socket dropped.
          const pending: Pending = {
            opId: inflight && !buffer ? inflight.opId : nextOpId(),
            ops,
            base: inflight ? inflight.base : previous.seq,
          };
          fresh.inflight = pending;
          fresh.resent = true;
          if (this.heldByCommand(version)) {
            fresh.resendHeld = true;
          } else {
            this.sendSubmit(version, pending);
          }
        }
        if (this.synced.has("published") && this.synced.has("draft")) {
          if (this.status !== "ready" && this.presence && !this.stopped) {
            // A new socket is a new editor to the others: announce it again.
            this.send({ type: "presence", ...this.presence });
          }
          this.setStatus("ready");
          this.sendCommandIfReady();
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
          this.confirm(state, message.seq);
          this.emit();
        }
        return;
      }
      case "reject": {
        const state = version ? this.versions[version] : undefined;
        if (state?.inflight && state.inflight.opId === message.opId) {
          this.refuseInflight(state, message.error === "resync");
        }
        return;
      }
      case "published":
      case "discarded":
        if (this.command?.sent && this.command.command === (message.type === "published" ? "publish" : "discard")) {
          this.settleCommand(null);
          return;
        }
        this.emit();
        return;
      case "error":
        this.receiveError(message);
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
   * The server would not take `state`'s in-flight op, which is dropped. The
   * version starts again from the server's document, its snapshot already
   * on the way when `snapshotComing`; edits made since are resent with it.
   */
  private refuseInflight(state: VersionState, snapshotComing: boolean): void {
    state.inflight = null;
    state.resent = false;
    state.resendHeld = false;
    state.resyncing = true;
    if (!snapshotComing) {
      this.send({ type: "snapshot", version: state.version });
    }
    if (state.version === "draft" && this.command) {
      // Made before the click: sent now, the command would act on a draft without it.
      this.settleCommand({ reason: "refused", command: this.command.command });
      return;
    }
    this.sendCommandIfReady();
    this.closeIfDrained();
  }

  /**
   * The engine's answer to a message that failed, or to opening a scene it
   * does not have. It names the message (`for`), and a submit's op id; an
   * engine that does not is attributed by what is in flight (see the class
   * comment): the command once sent, as nothing else is then, and otherwise
   * an in-flight op.
   */
  private receiveError(message: Record<string, unknown>): void {
    if (message.reason === "not_found") {
      this.sceneGone();
      return;
    }
    const failed = message.for;
    if (failed === "submit") {
      const state = Object.values(this.versions).find(
        (candidate) =>
          candidate.inflight !== null &&
          candidate.inflight.opId === message.opId &&
          (message.version === undefined || message.version === candidate.version)
      );
      if (state) {
        this.refuseInflight(state, false);
      }
      return;
    }
    if (failed === "publish" || failed === "discard") {
      if (this.command?.sent && this.command.command === failed) {
        this.settleCommand({ reason: "failed", command: failed });
      }
      return;
    }
    if (failed !== undefined) {
      return;
    }
    if (this.command?.sent) {
      this.settleCommand({ reason: "failed", command: this.command.command });
      return;
    }
    const { draft, published } = this.versions;
    const inflight = [draft, published].find((state) => state?.inflight && !state.resendHeld);
    if (inflight) {
      this.refuseInflight(inflight, false);
    }
  }

  /**
   * The engine does not have the scene: nothing pending can be delivered,
   * and no reconnect can open it. What was pending is reported and dropped.
   */
  private sceneGone(): void {
    const command = this.command?.command ?? null;
    const edits = this.hasUnconfirmed();
    this.forgetPending();
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (command !== null || edits) {
      this.options.onDropped?.({ reason: "gone", command, edits });
    }
    if (this.draining) {
      this.close();
      return;
    }
    const socket = this.socket;
    this.socket = null;
    this.synced.clear();
    socket?.close();
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setStatus("gone");
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
      if (state.resent) {
        // A resent op was not shown: show it as the server applied it, after
        // any edits buffered since, like another editor's.
        state.resent = false;
        state.doc = applyOps(state.doc, this.transformBuffer(state, ops));
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
    if (state.inflight && !state.resent) {
      const inflight = state.inflight.ops;
      state.inflight.ops = transformOps(inflight, remote, "left");
      remote = transformOps(remote, inflight, "right");
    }
    remote = this.transformBuffer(state, remote);
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
   * Transforms a version's buffered edits against an op the server applied
   * before them, and returns that op as it applies after them.
   */
  private transformBuffer(state: VersionState, applied: Json0Component[]): Json0Component[] {
    const buffer = state.buffer;
    if (buffer === null) {
      return applied;
    }
    state.buffer = transformOps(buffer, applied, "left");
    return transformOps(applied, buffer, "right");
  }

  private confirm(state: VersionState, seq: number): void {
    state.seq = Math.max(state.seq, seq);
    // A held resend confirmed here is its op's first submission, answered on this socket.
    state.inflight = null;
    state.resent = false;
    state.resendHeld = false;
    this.advance();
  }

  private closeIfDrained(): void {
    if (this.draining && !this.hasPending()) {
      this.close();
    }
  }

  private submit(state: VersionState, ops: Json0Component[]): void {
    const pending: Pending = { opId: nextOpId(), ops, base: state.seq };
    state.inflight = pending;
    this.sendSubmit(state.version, pending);
  }

  private sendSubmit(version: SceneVersion, pending: Pending): void {
    this.send({ type: "submit", version, base: pending.base, opId: pending.opId, ops: pending.ops });
  }

  /** Forgets every edit and command not yet through, sending none of them. */
  private forgetPending(): void {
    this.desired = null;
    this.setCommand(null);
    for (const state of Object.values(this.versions)) {
      state.inflight = null;
      state.buffer = null;
      state.resent = false;
      state.resendHeld = false;
    }
  }

  private close(): void {
    // Closing on purpose (`abandon`) forgets what is pending first; whatever
    // is left here was given up on: the drain ran out, or the engine would
    // not open a session.
    const command = this.command;
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
    if (command?.sent) {
      this.options.onDropped?.({ reason: "uncertain", command: command.command });
    }
    const unsent = command && !command.sent ? command.command : null;
    if (unsent !== null || edits) {
      this.options.onDropped?.({ reason: "undelivered", command: unsent, edits });
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
      command: this.command?.command ?? null,
    });
  }
}
