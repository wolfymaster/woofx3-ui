/**
 * Footer label for the engine's reported release. The engine reports its
 * image tag, which is not guaranteed to be semver: a release is a bare number
 * like "0.2.1" or a tag like "v0.2.1", while "dev" and CI builds carry
 * arbitrary names. Only a value that starts with a digit gets the "v" prefix.
 * Null (unknown, unreachable, or an engine that reports no version) is "v—".
 */
export function formatEngineVersion(version: string | null): string {
  const trimmed = version?.trim();
  if (!trimmed) {
    return "v—";
  }
  if (/^\d/.test(trimmed)) {
    return `v${trimmed}`;
  }
  return trimmed;
}
