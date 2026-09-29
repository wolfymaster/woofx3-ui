import { GoLiveChecklist } from "@/components/go-live/go-live-checklist";
import { PageHeader } from "@/components/layout/page-header";

export default function GoLive() {
  return (
    <div className="container mx-auto max-w-2xl p-6">
      <PageHeader title="Go live" description="A 30-second pre-flight: find a broken setup before your viewers do." />
      <GoLiveChecklist variant="page" />
    </div>
  );
}
