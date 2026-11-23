import { WebhookEventLogTable } from "@/components/debug/webhook-event-log-table";
import { PageHeader } from "@/components/layout/page-header";

export default function Logs() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Logs" description="Everything that happened on your channel, newest first." />

      <WebhookEventLogTable />
    </div>
  );
}
