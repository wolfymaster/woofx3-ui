/** Shown in place of the steps when a stored definition can't be read as a tree without changing it. */
export function WorkflowNotEditable({ reason }: { reason: string }) {
  return (
    <div className="space-y-1 text-sm text-muted-foreground" data-testid="text-workflow-not-editable">
      <p className="font-medium text-foreground">This workflow can't be edited here.</p>
      <p>{reason}</p>
    </div>
  );
}
