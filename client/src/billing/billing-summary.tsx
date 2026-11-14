export interface BillingSummaryItem {
  label: string;
  value: string;
  testId?: string;
}

/**
 * A labelled pair of facts about something billed — the plan and its state for
 * an organization, the amount and cadence for a sponsorship. The same shape
 * either subject fills in.
 */
export function BillingSummary({ items }: { items: BillingSummaryItem[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="font-medium" data-testid={item.testId}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
