import { Tally5 } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function Counters() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Counters" description="Track running totals your stream can read, increment, and reset." />

      <EmptyState
        icon={Tally5}
        title="Counters are on the way"
        description="Counter management isn't wired up to the engine yet. Until then, keep counts in a workflow variable."
      />
    </div>
  );
}
