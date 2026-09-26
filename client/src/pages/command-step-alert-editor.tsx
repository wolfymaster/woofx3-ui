import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Loader2, MessageSquare } from "lucide-react";
import { useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { AlertLayoutEditor } from "@/components/alert-editor/alert-layout-editor";
import { EmptyState } from "@/components/common/empty-state";
import { useOpenCommandDraft } from "@/hooks/use-command-draft";
import { useInstance } from "@/hooks/use-instance";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { commandStepId, NEW_COMMAND_KEY, updateCommandDraft } from "@/lib/command-drafts";
import { COMMAND_LIST_PATH, COMMAND_NEW_ROUTE, commandEditorPath } from "@/lib/command-editor-route";
import { splitCommandInput } from "@/lib/command-input";
import { commandStepVariables } from "@/lib/command-variables";
import { resolveActionStepPreset } from "@/lib/workflow-presets-json";

/**
 * One chat command step's alert content, on its own route.
 *
 * The editing itself is AlertLayoutEditor, the same one the Alerts screen uses; this
 * finds the step the route names in the command's draft (lib/command-drafts.ts) and
 * hands the layout back to it. Done returns to the command editor, where the change
 * waits with the command's other unsaved edits for Save.
 */
export default function CommandStepAlertEditor() {
  const params = useParams<{ engineCommandId: string; actionId: string }>();
  const engineCommandId = decodeParam(params.engineCommandId);
  const actionId = decodeParam(params.actionId);
  const isNew = engineCommandId === NEW_COMMAND_KEY;
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const { actionPresets, loading: catalogLoading } = useWorkflowCatalog();

  const commandsRaw = useQuery(api.chatCommands.list, instance ? { instanceId: instance._id } : "skip");
  const existing = commandsRaw?.find((doc) => doc.engineCommandId === engineCommandId);
  const draft = useOpenCommandDraft(engineCommandId, existing);

  const actions = draft?.value.actions;
  const stepIndex = actions?.findIndex((candidate, index) => commandStepId(candidate, index) === actionId) ?? -1;
  const step = actions && stepIndex >= 0 ? actions[stepIndex] : undefined;

  const availableVariables = useMemo(
    () =>
      actions && stepIndex >= 0
        ? commandStepVariables(
            splitCommandInput(draft?.value.command ?? "").argumentPattern,
            actions,
            stepIndex,
            (candidate) => resolveActionStepPreset(candidate, actionPresets)
          )
        : [],
    [draft?.value.command, actions, stepIndex, actionPresets]
  );

  const backHref = isNew ? COMMAND_NEW_ROUTE : commandEditorPath(engineCommandId);

  const keepLayout = (stored: unknown) => {
    updateCommandDraft(engineCommandId, (current) => ({
      ...current,
      actions: current.actions.map((candidate, index) =>
        commandStepId(candidate, index) === actionId
          ? { ...candidate, parameters: { ...(candidate.parameters ?? {}), layout: stored } }
          : candidate
      ),
    }));
  };

  if (commandsRaw === undefined || catalogLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // A command being created lives only in its draft, so a link opened in a fresh tab has
  // nothing to edit. One that is saved is reopened from the engine's copy by the draft hook.
  if (!draft || !step) {
    return (
      <div className="p-8">
        <EmptyState
          icon={MessageSquare}
          title="This step isn't here any more"
          description={
            isNew
              ? "A command that hasn't been created yet can only be edited from the page you started it on."
              : "The step it belonged to was removed, or the link is from another instance."
          }
          action={{ label: "Back to commands", onClick: () => navigate(COMMAND_LIST_PATH) }}
        />
      </div>
    );
  }

  const commandWord = splitCommandInput(draft.value.command).command;

  return (
    <AlertLayoutEditor
      value={step.parameters?.layout}
      context={
        <>
          {commandWord ? `!${commandWord}` : "New command"} · Step {stepIndex + 1}
        </>
      }
      backLabel={commandWord ? `!${commandWord}` : "the command"}
      availableVariables={availableVariables}
      onDone={(stored) => {
        if (stored !== null) {
          keepLayout(stored);
        }
        navigate(backHref);
      }}
      onCancel={() => navigate(backHref)}
    />
  );
}

/** A route segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
function decodeParam(segment: string | undefined): string {
  if (!segment) {
    return "";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
