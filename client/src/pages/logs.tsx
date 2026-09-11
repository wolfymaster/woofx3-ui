import { WebhookEventLogTable } from "@/components/debug/webhook-event-log-table";
import { PageHeader } from "@/components/layout/page-header";

export default function Logs() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Logs" description="The audit trail of every event the connected engine has sent." />

      <WebhookEventLogTable />
    </div>
  );
}
