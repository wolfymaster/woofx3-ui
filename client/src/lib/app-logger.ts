import { type AppLogger, consoleSink, createAppLogger } from "@/lib/logger";

/**
 * The one logger of a client process and the one place its sinks are chosen;
 * remote sinks (error tracking, product analytics) join the console here.
 * Only entry points import it: they hand it to LoggerProvider and to the
 * objects they construct, and everything else receives it.
 */
export const appLogger: AppLogger = createAppLogger([consoleSink]);
