type Env = Record<string, string | undefined>;

/**
 * Whether this Convex deployment is a pull request's preview. The preview workflow
 * (`.github/workflows/preview.yml`) sets `PREVIEW_DEPLOYMENT=true` on every preview
 * deployment; production never has it.
 *
 * A preview relaxes what setup insists on so it can be onboarded by automated tests
 * with a password account, which cannot connect Twitch. Nothing outside setup reads it.
 */
export function isPreviewDeployment(env: Env = process.env): boolean {
  return env.PREVIEW_DEPLOYMENT === "true";
}
