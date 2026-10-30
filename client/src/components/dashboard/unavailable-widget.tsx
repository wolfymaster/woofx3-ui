/**
 * Stands in for a saved widget the current catalog lacks: one this mode of
 * the app cannot serve (a hosted-only widget on a dashboard opened in local
 * mode), or one no catalog has any more. The layout keeps the widget, so it
 * comes back wherever it is available.
 */
export function UnavailableWidget({ type }: { type: string }) {
  return (
    <div
      className="h-full flex flex-col items-center justify-center gap-1 p-3 text-center text-sm text-muted-foreground"
      data-testid={`widget-unavailable-${type}`}
    >
      <span>This widget isn&apos;t available here.</span>
      <span className="text-xs">{type}</span>
    </div>
  );
}

/** How the rail and edit mode name a widget the catalog lacks. */
export function unavailableWidgetLabel(type: string): string {
  return `Not available here: ${type}`;
}
