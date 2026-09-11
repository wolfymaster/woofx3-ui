import { ListOrdered } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function Queues() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="Queues"
        description="Line up viewer requests — songs, games, shoutouts — and work through them."
      />

      <EmptyState
        icon={ListOrdered}
        title="Queues are on the way"
        description="Queue management isn't wired up to the engine yet. Chat commands can still collect requests in the meantime."
      />
    </div>
  );
}
