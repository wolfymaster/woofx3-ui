import { PageHeader } from "@/components/layout/page-header";
import { LogExplorer } from "@/components/logs/log-explorer";

export default function Logs() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Logs" description="What the engine has been doing, newest first." />
      <LogExplorer />
    </div>
  );
}
