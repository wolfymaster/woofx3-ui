export const PASSWORD_MIN_LENGTH = 8;

export type RegisterErrorKind = "password" | "exists-or-unknown";

export interface RegisterError {
  kind: RegisterErrorKind;
  message: string;
}

/**
 * Maps a failed password sign-up to friendly copy. Production Convex redacts
 * server errors to a bare "Server Error", so an existing account cannot be told
 * apart from other failures there; every non-password failure therefore points
 * at signing in.
 */
export function registerError(err: unknown): RegisterError {
  const raw = err instanceof Error ? err.message : String(err);
  if (/invalid password/i.test(raw)) {
    return { kind: "password", message: `Use a password with at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  return {
    kind: "exists-or-unknown",
    message: "We couldn't create your account. If you already signed up with this email, sign in instead.",
  };
}
