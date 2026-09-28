/**
 * Which of a module's stored settings may be shown to the browser.
 *
 * A module stores more than its manifest declares: its functions call
 * `ctx.module.setSetting` for their own state, and an OAuth integration writes
 * the provider's access and refresh tokens. Those rows are plain `string`
 * settings to the engine, so its secret masking does not cover them. The
 * settings form only renders declared fields, so only declared keys go back;
 * anything else stays on the server. With no readable manifest, nothing does.
 */
export function declaredSettingsOnly<T extends { key: string }>(settings: readonly T[], manifest: unknown): T[] {
  const declared = declaredSettingIds(manifest);
  return settings.filter((setting) => declared.has(setting.key));
}

function declaredSettingIds(manifest: unknown): Set<string> {
  const ids = new Set<string>();
  if (!manifest || typeof manifest !== "object") {
    return ids;
  }
  const settings = (manifest as { settings?: unknown }).settings;
  if (!Array.isArray(settings)) {
    return ids;
  }
  for (const field of settings) {
    const id = field && typeof field === "object" ? (field as { id?: unknown }).id : undefined;
    if (typeof id === "string" && id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}
