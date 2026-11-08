import { EmptyState } from "@/components/common/empty-state";

export function EngineEmpty() {
  return <EmptyState title="No instance connected" description="Pick an instance to continue." />;
}

export function EngineNote() {
  return <p>This instance has no page yet.</p>;
}
