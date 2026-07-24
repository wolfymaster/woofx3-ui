import { describe, expect, it } from "bun:test";
import { computeCodeChallenge, generateCodeVerifier } from "./pkce";

describe("generateCodeVerifier", () => {
  it("produces a verifier within the RFC 7636 length range using only unreserved chars", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("is random across calls", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe("computeCodeChallenge", () => {
  it("matches the known RFC 7636 appendix B test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await computeCodeChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("is deterministic for the same verifier", async () => {
    const verifier = generateCodeVerifier();
    expect(await computeCodeChallenge(verifier)).toBe(await computeCodeChallenge(verifier));
  });
});
