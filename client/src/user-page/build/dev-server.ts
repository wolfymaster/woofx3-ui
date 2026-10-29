/**
 * The port `bun run dev:user-page` serves the user page on, which the
 * dashboard's dev server forwards `/u/` to (vite.config.ts), so one browser
 * origin shows both as production does. WOOFX3_USER_PAGE_PORT moves it, for
 * running several worktrees side by side.
 */
export const DEFAULT_USER_PAGE_DEV_PORT = 5174;

export function userPageDevPort(env: Record<string, string | undefined>): number {
  const raw = env.WOOFX3_USER_PAGE_PORT?.trim();
  if (raw === undefined || raw === "") {
    return DEFAULT_USER_PAGE_DEV_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`WOOFX3_USER_PAGE_PORT must be a port number, not "${raw}"`);
  }
  return port;
}
