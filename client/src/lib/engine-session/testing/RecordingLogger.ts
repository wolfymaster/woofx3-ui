import type { LogFields, Logger } from "../deps";

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields?: LogFields;
}

/** A logger that keeps what it is told, for tests to assert on. */
export class RecordingLogger implements Logger {
  readonly entries: LogEntry[] = [];

  debug(message: string, fields?: LogFields): void {
    this.entries.push({ level: "debug", message, fields });
  }

  info(message: string, fields?: LogFields): void {
    this.entries.push({ level: "info", message, fields });
  }

  warn(message: string, fields?: LogFields): void {
    this.entries.push({ level: "warn", message, fields });
  }

  error(message: string, fields?: LogFields): void {
    this.entries.push({ level: "error", message, fields });
  }
}
