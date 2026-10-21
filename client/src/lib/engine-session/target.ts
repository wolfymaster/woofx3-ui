import { z } from "zod";

/**
 * The engine a session connects to and the client credentials it
 * authenticates with. `clientSecret` is the 64 hex characters the engine's
 * `registerClient` returned.
 */
export const engineTargetSchema = z.object({
  url: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters"),
});

export type EngineTarget = z.infer<typeof engineTargetSchema>;

/**
 * Where a session learns its engine. The session validates what `current`
 * answers, because a source reads it across a process or storage boundary.
 * `onChange` tells the session to read `current` again (credential rotation,
 * re-registration); it returns the unsubscribe.
 */
export interface EngineTargetSource {
  current(): Promise<EngineTarget>;
  onChange(listener: () => void): () => void;
}

/** Why a target was rejected, naming the fields and never their values: the secret must not reach a log. */
export function describeTargetIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "target"}: ${issue.message}`).join("; ");
}
