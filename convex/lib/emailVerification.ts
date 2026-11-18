// Proving a user controls their email address: a short numeric code is mailed
// to it and typed back. Only a hash of the code is stored.

export const EMAIL_VERIFICATION = {
  codeLength: 6,
  codeTtlMs: 15 * 60 * 1000,
  /** Wrong guesses allowed before the code is void and a new one must be requested. */
  maxFailedAttempts: 5,
  /** The maintenance API template that carries the code; it must exist there and be mapped to an ESP template. */
  template: "account-verification-code",
  requestTimeoutMs: 10_000,
} as const;

/** Picks an integer in [0, max) uniformly; production passes a cryptographic source. */
export type RandomInt = (max: number) => number;

export const cryptoRandomInt: RandomInt = (max) => {
  // Rejection sampling keeps every value equally likely when max does not divide 2^32.
  const limit = 2 ** 32 - (2 ** 32 % max);
  const word = new Uint32Array(1);
  do {
    crypto.getRandomValues(word);
  } while (word[0] >= limit);
  return word[0] % max;
};

export function newVerificationCode(randomInt: RandomInt): string {
  let code = "";
  for (let i = 0; i < EMAIL_VERIFICATION.codeLength; i++) {
    code += String(randomInt(10));
  }
  return code;
}

/** Salted with the user id so equal codes of different users never share a hash. */
export async function hashVerificationCode(userId: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}:${code}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface VerificationMailer {
  sendCode(request: { to: string; code: string; idempotencyKey: string }): Promise<void>;
}

/** Queues the code as a transactional email through the maintenance API's email route. */
export class MaintenanceVerificationMailer implements VerificationMailer {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async sendCode(request: { to: string; code: string; idempotencyKey: string }): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/email/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": request.idempotencyKey,
      },
      body: JSON.stringify({
        template: EMAIL_VERIFICATION.template,
        to: request.to,
        variables: { code: request.code, expires_minutes: EMAIL_VERIFICATION.codeTtlMs / 60_000 },
      }),
      signal: AbortSignal.timeout(EMAIL_VERIFICATION.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`the email service answered ${response.status}`);
    }
  }
}

/**
 * The deployment's mailer, or null when it has no email service credentials.
 * The key needs the `email:send` scope; `MAINTENANCE_EMAIL_KEY` wins over the shared `MAINTENANCE_API_KEY`.
 */
export function verificationMailerFromEnv(env: Record<string, string | undefined>): VerificationMailer | null {
  const baseUrl = env.MAINTENANCE_API_URL;
  const apiKey = env.MAINTENANCE_EMAIL_KEY || env.MAINTENANCE_API_KEY;
  if (!baseUrl || !apiKey) {
    return null;
  }
  return new MaintenanceVerificationMailer(baseUrl.replace(/\/+$/, ""), apiKey);
}
