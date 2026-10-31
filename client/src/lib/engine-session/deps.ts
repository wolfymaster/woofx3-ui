// What a live engine session needs from its host, passed in rather than read
// from globals so tests run on a fake clock, a seeded random source and a
// recording logger.

/** Cancels a scheduled callback; calling it after the callback ran does nothing. */
export type Cancel = () => void;

export interface Clock {
  /** Epoch ms. */
  now(): number;
  schedule(delayMs: number, run: () => void): Cancel;
}

/** Returns a number in [0, 1). */
export type Random = () => number;

/** Returns a new id, unique among every id it has returned and will return. */
export type IdSource = () => string;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Throws unless `value` is a positive integer, so a bad tunable stops construction instead of misbehaving later. */
export function requirePositiveInteger(owner: string, name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${owner}: ${name} must be a positive integer, got ${value}`);
  }
}

/**
 * Calls every listener with `args`, each in its own try/catch: a listener
 * that throws is logged and the rest still run, so no subscriber can knock
 * the state machine that notifies it into a wrong state.
 */
export function notifyAll<Args extends unknown[]>(
  listeners: Iterable<(...args: Args) => void>,
  logger: Logger,
  what: string,
  ...args: Args
): void {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch (error) {
      logger.error(`${what}: a listener threw`, { error });
    }
  }
}
