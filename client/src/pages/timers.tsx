import { Timer } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function Timers() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Timers" description="Run messages and actions on a repeating schedule while you're live." />

      <EmptyState
        icon={Timer}
        title="Timers are on the way"
        description="Scheduled timers aren't wired up to the engine yet. Until then, drive recurring actions from a workflow."
      />
    </div>
  );
}
