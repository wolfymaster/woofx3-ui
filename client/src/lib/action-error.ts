import { ConvexError } from "convex/values";

/**
 * The sentence to show for a failed Convex action.
 *
 * A ConvexError carries it as `data`, or as `data.message` when its data is
 * a coded refusal (`{ code, message }`). A plain Error thrown inside an action
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
  if (error instanceof ConvexError && typeof error.data?.message === "string") {
    return error.data.message;
  }
  const raw = error instanceof Error ? error.message : String(error);
  const uncaught = raw.match(/Uncaught (?:Convex)?Error: ([^\n]*)/);
  if (uncaught) {
    return uncaught[1].trim();
  }
  if (raw.includes("Server Error")) {
    const requestId = convexRequestId(error);
    return requestId ? `Something went wrong (request ${requestId})` : "Something went wrong";
  }
  return raw;
}

/** The request id Convex puts in a failed call's message, for matching a client report to the server log. */
export function convexRequestId(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.match(/\[Request ID: ([^\]]+)\]/)?.[1] ?? null;
}
