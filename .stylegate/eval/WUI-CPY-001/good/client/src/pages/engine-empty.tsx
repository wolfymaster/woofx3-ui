import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";

export function EngineEmpty({ instanceId, deleteInstance }: { instanceId: string; deleteInstance: (a: { instanceId: string }) => void }) {
  return (
    <>
      <EmptyState title="No engine connected" description="Pick an engine to continue." />
      <Button data-testid="button-delete-instance" onClick={() => deleteInstance({ instanceId })}>
        Delete engine
      </Button>
      <p>No resource instances for this module.</p>
    </>
  );
}
