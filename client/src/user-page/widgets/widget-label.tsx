/** The small heading over a counter or timer's reading. */
export function WidgetLabel({ children }: { children: string }) {
  return <p className="text-sm font-medium text-muted">{children}</p>;
}
