import { GraduationCap } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function Learning() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Learning" description="Guides and walkthroughs for getting the most out of your instance." />

      <EmptyState
        icon={GraduationCap}
        title="Guides are on the way"
        description="Tutorials for workflows, scenes, and modules will land here."
      />
    </div>
  );
}
