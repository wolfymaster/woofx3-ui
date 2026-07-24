import { TRIGGER_GROUPS } from "@/components/debug/triggers-registry";
import { WebhookEventLogTable } from "@/components/debug/webhook-event-log-table";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Debug() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="Debug"
        description="Hand-fire events at the connected engine, and inspect the audit trail of every event it has sent."
      />

      <Tabs defaultValue="triggers" className="space-y-6">
        <TabsList>
          <TabsTrigger value="triggers" data-testid="tab-triggers">
            Triggers
          </TabsTrigger>
          <TabsTrigger value="event-log" data-testid="tab-event-log">
            Event Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="triggers" className="mt-0 space-y-6">
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
        </TabsContent>

        <TabsContent value="event-log" className="mt-0">
          <WebhookEventLogTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
