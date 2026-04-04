type Level = "info" | "warn" | "error";

function log(level: Level, msg: string, data?: Record<string, unknown>) {
  const entry = { level, msg, ...data, ts: Date.now() };
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export const logger = {
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};
