export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface LogEntry {
  level: LogLevel;
  /** Names the part of the app that logged, such as "engine". */
  scope?: string;
  message: string;
  fields?: LogFields;
}

/** Receives every entry. A failing sink is skipped so the other sinks still get the entry. */
export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function createLogger(sinks: readonly LogSink[], scope?: string): Logger {
  const write =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      const entry: LogEntry = { level, message };
      if (scope !== undefined) {
        entry.scope = scope;
      }
      if (fields !== undefined) {
        entry.fields = fields;
      }
      for (const sink of sinks) {
        try {
          sink(entry);
        } catch {
          // Logging must never break the code that logs; the other sinks still run.
        }
      }
    };
  return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

/** Writes to the browser console. Fields go as a second argument so devtools keeps Error stacks inspectable. */
export const consoleSink: LogSink = ({ level, scope, message, fields }) => {
  const line = scope === undefined ? message : `[${scope}] ${message}`;
  if (fields === undefined) {
    console[level](line);
  } else {
    console[level](line, fields);
  }
};

/** The app's logger: a Logger that can hand out loggers labelled with a scope, writing to the same sinks. */
export interface AppLogger extends Logger {
  scoped(scope: string): Logger;
}

export function createAppLogger(sinks: readonly LogSink[]): AppLogger {
  return { ...createLogger(sinks), scoped: (scope) => createLogger(sinks, scope) };
}
