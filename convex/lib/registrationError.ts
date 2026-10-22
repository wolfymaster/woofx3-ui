import { refusalReason } from "@woofx3/api/rpc";

/**
 * The text shown to a user when the registration handshake throws: the
 * engine's own sentence for a refusal (the marker is for code, not people),
 * the raw message for anything else.
 */
export function registrationFailureMessage(err: unknown): string {
  const reason = refusalReason(err);
  if (reason !== null) {
    return reason;
  }
  return err instanceof Error ? err.message : String(err);
}
