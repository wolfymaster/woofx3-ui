import { MessageSquarePlus } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function Feedback() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="Submit Feedback"
        description="Tell us what's broken, what's missing, and what you'd like next."
      />

      <EmptyState
        icon={MessageSquarePlus}
        title="Feedback submission is on the way"
        description="The in-app feedback form isn't hooked up yet."
      />
    </div>
  );
}
