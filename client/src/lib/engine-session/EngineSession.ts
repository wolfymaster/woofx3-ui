import type { EngineCapability, Woofx3EngineApi } from "@woofx3/api";
import type { EngineBrowserSession } from "@woofx3/api/client";
import { EngineDisconnectedError, EngineTimeoutError } from "@/engine/errors";
import { createReconnectBackoff, type ReconnectBackoff } from "@/lib/reconnect-backoff";
import { isAuthenticationRefused } from "./authentication";
import { readEngineCapabilities } from "./capabilities";
import { type EngineSessionConfig, validateEngineSessionConfig } from "./config";
import { type Cancel, type Clock, type Logger, notifyAll, type Random } from "./deps";
import { describeTargetIssues, type EngineTarget, type EngineTargetSource, engineTargetSchema } from "./target";

/** What every engine session can ask before it knows anything else about the engine. */
export type EngineSessionApi = Pick<Woofx3EngineApi, "getEngineCapabilities">;

export type OpenEngineSession<Api> = (target: EngineTarget) => EngineBrowserSession<Api>;

export type RefusalReason = "target" | "credentials" | "incompatible";

/**
 * `refused` waits for the target to change, or, for `incompatible`, for
 * `reconnectNow` after the engine was replaced in place; every other state
 * moves on by itself.
 */
export type SessionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected"; capabilities: readonly EngineCapability[] }
  | { status: "waiting"; attempt: number; retryAt: number; lastError: string }
  | { status: "refused"; reason: RefusalReason; message: string };

/** What the host does with each new session, the part of a live session that differs between hosts. */
export interface SessionHooks<Api> {
  /**
   * Runs once the session has proved itself and before it counts as
   * connected: subscriptions a new session needs go here, since nothing
   * carries over from the session before. Calls made through `call` work
   * from here on. A rejection fails the attempt and it is retried.
   *
   * `lost` reports that something the host set up here has ended while the
   * socket stays open (the engine dropping a subscription). The session then
   * treats this session as broken and reconnects. It is bound to this
   * attempt, so a call after the session was replaced does nothing.
   */
  attach(api: Api, lost: (reason: unknown) => void): Promise<void>;
  /** The target changed: whatever was read from the old engine or under the old credentials is not this one's. */
  retargeted(): void;
}

export interface EngineSessionDeps<Api> {
  targets: EngineTargetSource;
  open: OpenEngineSession<Api>;
  /** Capabilities the host cannot run without; an engine missing one is refused, not retried. */
  required: readonly EngineCapability[];
  hooks: SessionHooks<Api>;
  clock: Clock;
  random: Random;
  logger: Logger;
  config: EngineSessionConfig;
}

interface Link<Api> {
  handle: EngineBrowserSession<Api>;
  /** Proven: its capabilities were read and accepted, so calls may use it. */
  usable: boolean;
  broken: boolean;
}

/** An epoch ms on the injected clock, and the budget it was set from for the timeout's message. */
interface Deadline {
  at: number;
  budgetMs: number;
}

const IDLE: SessionState = { status: "idle" };

/**
 * One long-lived capnweb session to an engine, kept open: it reconnects with
 * capped, jittered backoff, refuses an engine it cannot work with, and gives
 * every call a deadline.
 *
 * Every attempt, session callback and retry belongs to a generation.
 * Stopping, retargeting and each new attempt start a new one: an attempt or
 * retry timer from an older generation does nothing, and a broken or lost
 * report counts only for the session that is current. Disposing a session can
 * itself report it broken, and a timer must not revive a session the host has
 * moved off.
 */
export class EngineSession<Api extends EngineSessionApi> {
  private snapshot: SessionState = IDLE;
  private readonly listeners = new Set<() => void>();
  private readonly backoff: ReconnectBackoff;
  private generation = 0;
  private running = false;
  private link: Link<Api> | null = null;
  private cancelRetry: Cancel | null = null;
  private unwatchTarget: (() => void) | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(private readonly deps: EngineSessionDeps<Api>) {
    validateEngineSessionConfig(deps.config);
    this.backoff = createReconnectBackoff({
      baseMs: deps.config.reconnectBaseMs,
      maxMs: deps.config.reconnectMaxMs,
      random: deps.random,
    });
  }

  get state(): SessionState {
    return this.snapshot;
  }

  /** Calls `listener` after every state change; returns the unsubscribe. Shaped for `useSyncExternalStore`. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Starts connecting; does nothing while already started. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.unwatchTarget = this.deps.targets.onChange(() => this.retarget());
    this.connect();
  }

  /** Disposes the session and cancels any retry, then resolves once the attempt in flight has settled. */
  async stop(): Promise<void> {
    if (this.running) {
      this.running = false;
      this.unwatchTarget?.();
      this.unwatchTarget = null;
      this.teardown();
      this.setState(IDLE);
    }
    await this.inFlight;
  }

  /**
   * Connects now: skips the rest of a backoff wait, or checks again an engine
   * refused as incompatible, which may have been updated in place. Does
   * nothing in any other state, which is either moving already or waits for
   * a new target.
   */
  readonly reconnectNow = (): void => {
    const state = this.snapshot;
    const recheck = state.status === "refused" && state.reason === "incompatible";
    if (!this.running || (state.status !== "waiting" && !recheck)) {
      return;
    }
    this.backoff.reset();
    this.connect();
  };

  /**
   * Runs one RPC on the live session with the configured deadline. Rejects
   * with `EngineDisconnectedError` when there is no proven session or it
   * broke during the call, and with `EngineTimeoutError` past the deadline.
   */
  async call<T>(name: Extract<keyof Api, string>, invoke: (api: Api) => PromiseLike<T>): Promise<T> {
    const link = this.link;
    if (link === null || !link.usable || link.broken) {
      throw new EngineDisconnectedError(name);
    }
    try {
      return await this.withDeadline(name, this.deadlineIn(this.deps.config.rpcTimeoutMs), invoke(link.handle.api));
    } catch (error) {
      if (!(error instanceof EngineTimeoutError) && (link.broken || link !== this.link)) {
        throw new EngineDisconnectedError(name, { cause: error });
      }
      throw error;
    }
  }

  private retarget(): void {
    if (!this.running) {
      return;
    }
    this.deps.logger.info("EngineSession: target changed; reconnecting");
    this.teardown();
    notifyAll([() => this.deps.hooks.retargeted()], this.deps.logger, "EngineSession retargeted");
    this.backoff.reset();
    this.connect();
  }

  /** Starts a new generation: disposes the link and cancels the retry, so nothing from the old one acts again. */
  private teardown(): void {
    this.generation += 1;
    this.cancelRetry?.();
    this.cancelRetry = null;
    const link = this.link;
    this.link = null;
    link?.handle.dispose();
  }

  private connect(): void {
    this.teardown();
    this.setState({ status: "connecting", attempt: this.backoff.attempts + 1 });
    this.inFlight = this.establish(this.generation);
  }

  /** One connect attempt. Never rejects: every outcome becomes a state. */
  private async establish(generation: number): Promise<void> {
    let capabilities: EngineCapability[];
    try {
      const proven = await this.prove(generation);
      if (proven === null) {
        return;
      }
      capabilities = proven;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      if (isAuthenticationRefused(error)) {
        this.refuse("credentials", errorMessage(error));
        return;
      }
      this.wait(error);
      return;
    }
    this.backoff.reset();
    this.deps.logger.info("EngineSession: connected");
    this.setState({ status: "connected", capabilities });
  }

  /**
   * Opens, proves and attaches a session for `generation`. Answers its
   * capabilities once it may count as connected, and null when the attempt
   * ended otherwise (superseded, or refused here); throws when it failed.
   */
  private async prove(generation: number): Promise<EngineCapability[] | null> {
    const { config, hooks } = this.deps;
    const parsed = engineTargetSchema.safeParse(await this.deps.targets.current());
    if (generation !== this.generation) {
      return null;
    }
    if (!parsed.success) {
      this.refuse("target", describeTargetIssues(parsed.error));
      return null;
    }
    // One budget covers proving the session and the host's attach step.
    const deadline = this.deadlineIn(config.connectTimeoutMs);
    const link: Link<Api> = { handle: this.deps.open(parsed.data), usable: false, broken: false };
    this.link = link;
    link.handle.onBroken((error) => {
      if (link === this.link) {
        link.broken = true;
      }
      this.lose(link, error);
    });

    // One round trip proves the socket and the credentials, which the
    // pipelined authenticate does not on its own, and says what the engine
    // can do.
    const report = await this.withDeadline("getEngineCapabilities", deadline, link.handle.api.getEngineCapabilities());
    if (generation !== this.generation) {
      return null;
    }
    const reading = readEngineCapabilities(report);
    if (!reading.ok) {
      this.refuse("incompatible", reading.error);
      return null;
    }
    const missing = this.deps.required.filter((id) => !reading.capabilities.includes(id));
    if (missing.length > 0) {
      this.refuse("incompatible", `the engine does not support ${missing.join(", ")}; update the engine`);
      return null;
    }
    link.usable = true;
    await this.withDeadline(
      "attach",
      deadline,
      hooks.attach(link.handle.api, (reason) => this.lose(link, reason))
    );
    return generation === this.generation ? reading.capabilities : null;
  }

  /**
   * The current session stopped working: retry. An attempt still proving the
   * session fails through its pending read instead, and a report about a
   * session already replaced is stale.
   */
  private lose(link: Link<Api>, reason: unknown): void {
    if (link !== this.link || !link.usable) {
      return;
    }
    this.wait(reason);
  }

  private refuse(reason: RefusalReason, message: string): void {
    this.teardown();
    this.deps.logger.warn("EngineSession: refused the engine", { reason, message });
    this.setState({ status: "refused", reason, message });
  }

  private wait(error: unknown): void {
    this.teardown();
    const delay = this.backoff.next();
    const lastError = errorMessage(error);
    this.deps.logger.warn("EngineSession: connection failed; retrying", { delayMs: delay, error: lastError });
    const generation = this.generation;
    this.cancelRetry = this.deps.clock.schedule(delay, () => {
      if (generation !== this.generation) {
        return;
      }
      this.cancelRetry = null;
      this.connect();
    });
    this.setState({
      status: "waiting",
      attempt: this.backoff.attempts,
      retryAt: this.deps.clock.now() + delay,
      lastError,
    });
  }

  /** A deadline `budgetMs` from now on the injected clock. */
  private deadlineIn(budgetMs: number): Deadline {
    return { at: this.deps.clock.now() + budgetMs, budgetMs };
  }

  private withDeadline<T>(operation: string, deadline: Deadline, work: PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const remaining = Math.max(0, deadline.at - this.deps.clock.now());
      const cancel = this.deps.clock.schedule(remaining, () =>
        reject(new EngineTimeoutError(operation, deadline.budgetMs))
      );
      Promise.resolve(work).then(
        (value) => {
          cancel();
          resolve(value);
        },
        (error: unknown) => {
          cancel();
          reject(error);
        }
      );
    });
  }

  private setState(next: SessionState): void {
    this.snapshot = next;
    notifyAll(this.listeners, this.deps.logger, "EngineSession state");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
