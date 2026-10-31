import type { Clock, IdSource, LogFields, Logger, Random } from "./deps";

// The real clock, random source, ids and logger an engine session runs on
// in the app. Tests pass fakes instead (./testing).

export const systemClock: Clock = {
  now: () => Date.now(),
  schedule: (delayMs, run) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
};

export const systemRandom: Random = Math.random;

export const systemIds: IdSource = () => crypto.randomUUID();

/** The one logger an app process carries, writing to the browser console under `scope`. */
export function consoleLogger(scope: string): Logger {
  const write =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string, fields?: LogFields): void => {
      const line = `[${scope}] ${message}`;
      if (fields === undefined) {
        console[level](line);
      } else {
        console[level](line, fields);
      }
    };
  return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}
