// Stable, cross-path identity for a widget. The engine's two ingest paths supply
// different fields — the MODULE_WIDGET_REGISTERED webhook sends `projectionKey`
// but omits `id` for built-ins; `getAvailableWidgets()` sends `id` + `manifestId`
// but no `projectionKey`. Keying widget rows on `id` therefore produced duplicate
// `instanceWidgets` rows. The canonical key is the engine's projectionKey
// (`{createdByRef}:widget:{manifestId}`, e.g. `builtin:widget:media_alert`), which
// both paths can produce identically — see streamware/src/builtin-widgets.ts and
// db/app/services/module_event_payload.go (projectionKeyFor).
export function widgetCanonicalKey(input: {
  projectionKey?: string;
  createdByRef?: string;
  manifestId?: string;
  canonicalId?: string;
  id?: string;
}): string {
  if (input.projectionKey) {
    return input.projectionKey;
  }
  if (input.createdByRef && input.manifestId) {
    return `${input.createdByRef}:widget:${input.manifestId}`;
  }
  return input.canonicalId ?? input.id ?? "";
}
