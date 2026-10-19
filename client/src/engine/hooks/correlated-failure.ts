import type { CorrelatedFailure } from "@/engine/types";

/**
 * The failure to show for the current request. A send that failed for a
 * request since replaced resolves after the new one started, and must not be
 * read as the new one failing.
 */
export function failureForCurrentRequest(
  failure: CorrelatedFailure | null,
  correlationKey: string | null
): CorrelatedFailure | null {
  return failure !== null && failure.correlationKey === correlationKey ? failure : null;
}
