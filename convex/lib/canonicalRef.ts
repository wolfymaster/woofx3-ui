/**
 * Derive `{moduleId}:{kind}:{manifestId}` from a MODULE projection key
 * `{moduleKey}:{kind}:{manifestId}` where moduleKey is `{moduleId}:{version}:{hash}`.
 */
export function canonicalRefFromProjectionKey(
  projectionKey: string | undefined,
  kind: "trigger" | "action"
): string | undefined {
  if (!projectionKey) {
    return undefined;
  }
  const marker = `:${kind}:`;
  const idx = projectionKey.indexOf(marker);
  if (idx < 0) {
    return undefined;
  }
  const moduleKey = projectionKey.slice(0, idx);
  const manifestId = projectionKey.slice(idx + marker.length);
  const moduleId = moduleKey.split(":")[0];
  if (!moduleId || !manifestId) {
    return undefined;
  }
  return `${moduleId}:${kind}:${manifestId}`;
}
