// Stable, cross-path identity for a widget. The engine's two ingest paths supply
// different fields — the MODULE_WIDGET_REGISTERED webhook sends `projectionKey`
// but omits `id` for built-ins; `getAvailableWidgets()` sends `id` + `manifestId`
// but no `projectionKey`. Keying widget rows on `id` therefore produced duplicate
// `instanceWidgets` rows. The canonical key is the engine's projectionKey
// (`{createdByRef}:widget:{manifestId}`, e.g. `builtin:widget:media_alert`), which
// both paths can produce identically — see streamware/src/builtin-widgets.ts and
// db/app/services/module_event_payload.go (projectionKeyFor).
//
// Module keys may include version/hash segments (e.g. `spotify:1.0.0:abc1234`).
// We always normalise to the bare module name so scene placements survive module
// updates. Same invariant is enforced on the streamware read path.
export function widgetCanonicalKey(input: {
  projectionKey?: string;
  createdByRef?: string;
  manifestId?: string;
  canonicalId?: string;
  id?: string;
}): string {
  if (input.projectionKey) {
    return stableWidgetId(input.projectionKey) ?? input.projectionKey;
  }
  if (input.createdByRef && input.manifestId) {
    return `${baseModuleKey(input.createdByRef)}:widget:${input.manifestId}`;
  }
  if (input.canonicalId) {
    return stableWidgetId(input.canonicalId) ?? input.canonicalId;
  }
  return input.id ?? "";
}

/**
 * Normalise a (possibly versioned) widget canonical id to its stable form.
 * `"spotify:1.0.0:abc1234:widget:now_playing"` → `"spotify:widget:now_playing"`
 * `"builtin:widget:media_alert"` → `"builtin:widget:media_alert"` (unchanged)
 * Returns undefined when the input does not contain the `:widget:` marker.
 */
export function stableWidgetId(rawId: string): string | undefined {
  const marker = ":widget:";
  const idx = rawId.lastIndexOf(marker);
  if (idx <= 0) {
    return undefined;
  }
  const rawModuleKey = rawId.slice(0, idx);
  const manifestId = rawId.slice(idx + marker.length);
  if (!manifestId) {
    return undefined;
  }
  return `${baseModuleKey(rawModuleKey)}:widget:${manifestId}`;
}

/** Take the first colon-delimited segment of a module key, stripping version/hash. */
function baseModuleKey(key: string): string {
  const idx = key.indexOf(":");
  return idx === -1 ? key : key.slice(0, idx);
}
