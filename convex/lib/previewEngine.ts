import { engineApiUrl } from "./engineInstanceUrl";

/**
 * The engine a pull request's preview deployment is paired with, as the preview workflow
 * (`.github/workflows/preview.yml`) sets it on that Convex deployment. Production never has these set.
 *
 * The registration token stays on the server: the browser learns only where the engine is, and
 * registration presents the token when the instance being registered points at that engine.
 */
export interface PreviewEngine {
  url: string;
  version: string | null;
}

type Env = Record<string, string | undefined>;

export function previewEngine(env: Env = process.env): PreviewEngine | null {
  const url = env.PREVIEW_ENGINE_URL;
  if (!url) {
    return null;
  }
  return { url, version: env.PREVIEW_ENGINE_VERSION ?? null };
}

/** The token to register `instanceUrl` with, when it is this preview's engine; otherwise undefined. */
export function previewEngineRegistrationToken(instanceUrl: string, env: Env = process.env): string | undefined {
  const engine = previewEngine(env);
  const token = env.PREVIEW_ENGINE_REGISTRATION_TOKEN;
  if (!engine || !token) {
    return undefined;
  }
  return engineApiUrl(instanceUrl) === engineApiUrl(engine.url) ? token : undefined;
}
