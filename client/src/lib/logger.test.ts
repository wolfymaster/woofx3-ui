import { describe, expect, test } from "bun:test";
import { createAppLogger, createLogger, type LogEntry } from "./logger";

describe("createLogger", () => {
  test("sends every level to every sink, with scope and fields only when given", () => {
    const a: LogEntry[] = [];
    const b: LogEntry[] = [];
    const sinks = [(e: LogEntry) => a.push(e), (e: LogEntry) => b.push(e)];
    const error = new Error("boom");

    const logger = createLogger(sinks);
    logger.debug("tick");
    logger.info("started");
    logger.warn("slow", { ms: 900 });
    logger.error("failed", { error });
    createLogger(sinks, "engine").info("connected");

    const want: LogEntry[] = [
      { level: "debug", message: "tick" },
      { level: "info", message: "started" },
      { level: "warn", message: "slow", fields: { ms: 900 } },
      { level: "error", message: "failed", fields: { error } },
      { level: "info", scope: "engine", message: "connected" },
    ];
    expect(a).toEqual(want);
    expect(b).toEqual(want);
    expect(a[3]?.fields?.error).toBe(error);
  });

  test("a throwing sink neither breaks the caller nor starves the next sink", () => {
    const got: LogEntry[] = [];
    const logger = createLogger([
      () => {
        throw new Error("sink down");
      },
      (e) => got.push(e),
    ]);

    expect(() => logger.error("still logged")).not.toThrow();
    expect(got).toEqual([{ level: "error", message: "still logged" }]);
  });
});

describe("createAppLogger", () => {
  test("scoped loggers write to the app's sinks under their scope", () => {
    const got: LogEntry[] = [];
    const app = createAppLogger([(e) => got.push(e)]);

    app.warn("plain");
    app.scoped("engine").error("lost", { attempt: 2 });

    expect(got).toEqual([
      { level: "warn", message: "plain" },
      { level: "error", scope: "engine", message: "lost", fields: { attempt: 2 } },
    ]);
  });
});
