import { ConvexError } from "convex/values";

/**
 * A refusal Convex raised for the caller carries its text in `data`; it is
 * rethrown as a plain Error so callers read one error shape whichever gateway
 * answered.
 */
export function withPlainError(error: unknown): never {
  if (error instanceof ConvexError && typeof error.data === "string") {
    throw new Error(error.data);
  }
  throw error;
}
