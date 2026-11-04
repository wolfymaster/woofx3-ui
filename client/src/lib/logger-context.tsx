import { createContext, type ReactNode, useContext } from "react";
import type { AppLogger } from "@/lib/logger";

const LoggerContext = createContext<AppLogger | null>(null);

export function LoggerProvider({ logger, children }: { logger: AppLogger; children: ReactNode }) {
  return <LoggerContext.Provider value={logger}>{children}</LoggerContext.Provider>;
}

/** The logger the nearest LoggerProvider carries. Throws outside one, so a root that forgot it fails at once. */
export function useLogger(): AppLogger {
  const logger = useContext(LoggerContext);
  if (logger === null) {
    throw new Error("useLogger needs a LoggerProvider above it");
  }
  return logger;
}

export { LoggerContext };
