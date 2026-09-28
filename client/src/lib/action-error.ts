import { ConvexError } from "convex/values";

/**
 * The sentence to show for a failed Convex action.
 *
 * A ConvexError carries it as `data`. A plain Error thrown inside an action
 * reaches the client wrapped as `[CONVEX A(...)] [Request ID: ...] Server Error
 * Uncaught Error: <message>` followed by a stack, so the message is cut out of
 * that wrapper rather than shown whole.
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
  return raw;
}
