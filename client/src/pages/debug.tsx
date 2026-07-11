import { TRIGGER_GROUPS } from "@/components/debug/triggers-registry";
import { PageHeader } from "@/components/layout/page-header";

export default function Debug() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Debug" description="Hand-fire events at the connected engine for testing." />

      <section className="space-y-6">
        <h2 className="text-lg font-semibold tracking-tight">Triggers</h2>

        {TRIGGER_GROUPS.map((group) => (
          <div key={group.key} className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{group.heading}</h3>
            <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
              {group.entries.map(({ key, Form }) => (
                <Form key={key} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
