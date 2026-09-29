import { ConvexError } from "convex/values";

/**
 * The sentence to show for a failed Convex action.
 *
 * A ConvexError carries it as `data`. A plain Error thrown inside an action
 * reaches the client in one of two wrappers: in development
 * `[CONVEX A(...)] [Request ID: ...] Server Error Uncaught Error: <message>`
 * plus a stack, from which the message is cut out; in production only
 * `[CONVEX A(...)] [Request ID: ...] Server Error`, which says nothing a
 * person can act on, so it becomes a short line with the request id for a
 * bug report.
 */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  const raw = error instanceof Error ? error.message : String(error);
  const uncaught = raw.match(/Uncaught (?:Convex)?Error: ([^\n]*)/);
  if (uncaught) {
    return uncaught[1].trim();
  }
  if (raw.includes("Server Error")) {
    const requestId = raw.match(/\[Request ID: ([^\]]+)\]/)?.[1];
    return requestId ? `Something went wrong (request ${requestId})` : "Something went wrong";
  }
  return raw;
}
