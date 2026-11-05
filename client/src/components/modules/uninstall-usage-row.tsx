import { escapeDollarKeys, unescapeDollarKeys } from "@shared/dollar-keys";
import type { WorkflowDefinition } from "@woofx3/api";
import { Check, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScene, useUpdateSceneRequest } from "@/engine/hooks/use-scenes";
import { useDeleteWorkflowRequest, useUpdateWorkflowRequest, useWorkflow } from "@/engine/hooks/use-workflows";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { stepSummary } from "@/lib/step-summary";
import { manualFixNote, stepIdsUsing, type UsageRow, withoutThemedWidgets } from "@/lib/uninstall-conflicts";
import { resolveCatalogAction, triggerNodeLabel } from "@/lib/workflow-node-label";
import { triggerNodeSummary } from "@/lib/workflow-node-summary";
import {
  countActionSteps,
  definitionToTree,
  findStepInTree,
  removeStepFromTree,
  type StepNode,
  treeToDefinition,
} from "@/lib/workflow-tree";

interface UsageRowProps {
  row: UsageRow;
  isRemoved: boolean;
  /** The row's use of the module is gone: removed here, or found already gone. */
  onRemoved: (key: string) => void;
}

interface RowShellProps {
  title: ReactNode;
  /** The title as plain text, naming the row's button to a screen reader. */
  label: string;
  detail?: ReactNode;
  note?: string;
  isRemoved: boolean;
  action?: { label: string; run: () => Promise<void> };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One thing still using the module. Removed, it stays in the list as a quiet
 * dashed line, so the streamer sees what went and the list doesn't jump.
 */
function RowShell({ title, label, detail, note, isRemoved, action }: RowShellProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isRemoved) {
    return (
      <li className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-[13px] text-muted-foreground">
        <Check className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
        <span className="ml-auto shrink-0">Removed</span>
      </li>
    );
  }

  const run = async () => {
    if (!action) {
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await action.run();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium leading-snug">{title}</span>
        {detail && <span className="text-[13px] leading-snug text-muted-foreground">{detail}</span>}
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
      </div>
      {action && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={isBusy}
          aria-label={`${action.label}: ${label}`}
          onClick={() => {
            void run();
          }}
        >
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : action.label}
        </Button>
      )}
    </li>
  );
}

function useGone(isGone: boolean, row: UsageRow, onRemoved: (key: string) => void) {
  useEffect(() => {
    if (isGone) {
      onRemoved(row.key);
    }
  }, [isGone, row.key, onRemoved]);
}

function sourceLabel(row: UsageRow): string {
  return row.user?.sourceName || row.resource.resourceDisplayName || row.resource.resourceName || "Unnamed";
}

function ManualUsageRow({ row, isRemoved, note }: Omit<UsageRowProps, "onRemoved"> & { note?: string }) {
  const label = sourceLabel(row);
  return <RowShell title={label} label={label} note={note ?? manualFixNote(row)} isRemoved={isRemoved} />;
}

/**
 * A workflow using the module, read as its trigger and the steps the module
 * runs. Removing takes those steps out, or deletes the workflow when its
 * trigger is the module's or nothing would be left to run.
 */
function WorkflowUsageRow({ row, isRemoved, onRemoved }: UsageRowProps) {
  const engineWorkflowId = row.user?.sourceId ?? null;
  const canonicalId = row.resource.resourceName ?? "";
  const workflow = useWorkflow(engineWorkflowId);
  const { catalogTriggers, catalogActions } = useWorkflowCatalog();
  const updateWorkflow = useUpdateWorkflowRequest();
  const deleteWorkflow = useDeleteWorkflowRequest();

  const read = useMemo(() => {
    if (!workflow) {
      return undefined;
    }
    const definition = unescapeDollarKeys(workflow.definition) as WorkflowDefinition;
    const result = definitionToTree(definition);
    return result.editable ? { definition, tree: result.tree } : undefined;
  }, [workflow]);

  const stepIds = useMemo(
    () =>
      read
        ? row.fix === "workflow"
          ? read.tree.steps.map((step) => step.id)
          : stepIdsUsing(read.tree.steps, canonicalId)
        : [],
    [read, row.fix, canonicalId]
  );
  const remaining = useMemo(
    () => (read ? stepIds.reduce<StepNode[]>((steps, id) => removeStepFromTree(steps, id), read.tree.steps) : []),
    [read, stepIds]
  );

  useGone(workflow === null || (read !== undefined && row.fix === "steps" && stepIds.length === 0), row, onRemoved);

  if (workflow === undefined) {
    return <RowShell title={sourceLabel(row)} label={sourceLabel(row)} note="Loading…" isRemoved={isRemoved} />;
  }
  if (!engineWorkflowId || !read) {
    if (row.fix === "workflow" && engineWorkflowId) {
      const label = sourceLabel(row);
      return (
        <RowShell
          title={label}
          label={label}
          note="Its trigger comes from this module, so the whole workflow goes."
          isRemoved={isRemoved}
          action={{
            label: "Delete",
            run: async () => {
              await deleteWorkflow(engineWorkflowId);
              onRemoved(row.key);
            },
          }}
        />
      );
    }
    return <ManualUsageRow row={row} isRemoved={isRemoved} note="Open it to remove the step." />;
  }

  const { definition, tree } = read;
  const triggerLabel = triggerNodeLabel(tree.trigger, catalogTriggers);
  const triggerDetails = triggerNodeSummary(tree.trigger, catalogTriggers).join(", ");
  const stepTitles = stepIds
    .map((id) => findStepInTree(tree.steps, id))
    .filter((step): step is StepNode => step !== undefined)
    .map(
      (step) =>
        stepSummary(step, { action: step.type === "action" ? resolveCatalogAction(step, catalogActions) : undefined })
          .title
    );
  const deletesWorkflow = row.fix === "workflow" || countActionSteps(remaining) === 0;
  const note =
    row.fix === "workflow"
      ? "Its trigger comes from this module, so its steps go with it."
      : deletesWorkflow
        ? "Nothing else runs on this trigger, so the trigger goes too."
        : undefined;

  const run = async () => {
    if (deletesWorkflow) {
      await deleteWorkflow(engineWorkflowId);
      onRemoved(row.key);
      return;
    }
    const next = treeToDefinition({ ...tree, steps: remaining });
    next.id = definition.id;
    next.name = definition.name;
    const outcome = await updateWorkflow(engineWorkflowId, escapeDollarKeys(next), workflow?.revision);
    if (outcome.conflict) {
      throw new Error("This changed while the list was open. Check it and try again.");
    }
    onRemoved(row.key);
  };

  return (
    <RowShell
      title={
        <>
          {triggerLabel}
          {triggerDetails && <span className="font-normal text-muted-foreground"> {triggerDetails}</span>}
        </>
      }
      label={triggerLabel}
      detail={stepTitles.join(", ")}
      note={note}
      isRemoved={isRemoved}
      action={{ label: deletesWorkflow ? "Delete" : "Remove", run }}
    />
  );
}

/** A scene with widgets wearing the module's theme; removing takes those widgets off it. */
function SceneUsageRow({ row, isRemoved, onRemoved }: UsageRowProps) {
  const engineSceneId = row.user?.sourceId ?? "";
  const themeId = row.resource.resourceName ?? "";
  const scene = useScene(engineSceneId);
  const updateScene = useUpdateSceneRequest();
  const cleared = useMemo(
    () => (scene ? withoutThemedWidgets(unescapeDollarKeys(scene.widgets), themeId) : undefined),
    [scene, themeId]
  );

  useGone(cleared !== undefined && cleared.removed.length === 0, row, onRemoved);

  if (scene === undefined) {
    return <RowShell title={sourceLabel(row)} label={sourceLabel(row)} note="Loading…" isRemoved={isRemoved} />;
  }
  if (scene === null || !cleared) {
    return <ManualUsageRow row={row} isRemoved={isRemoved} note="Open it and remove the widget using this theme." />;
  }

  const theme = row.resource.resourceDisplayName || "this module's";
  const widgets = cleared.removed.join(", ");
  const label = scene.name;
  return (
    <RowShell
      title={label}
      label={label}
      detail={`${widgets} ${cleared.removed.length === 1 ? "uses" : "use"} the ${theme} theme`}
      isRemoved={isRemoved}
      action={{
        label: "Remove",
        run: async () => {
          const result = await updateScene(engineSceneId, { widgetsJson: JSON.stringify(cleared.value) });
          if (!result.success) {
            throw new Error("The engine didn't save the scene. Try again.");
          }
          onRemoved(row.key);
        },
      }}
    />
  );
}

export function UninstallUsageRow(props: UsageRowProps) {
  switch (props.row.fix) {
    case "workflow":
    case "steps":
      return <WorkflowUsageRow {...props} />;
    case "widgets":
      return <SceneUsageRow {...props} />;
    case "none":
      return <ManualUsageRow row={props.row} isRemoved={props.isRemoved} />;
  }
}
