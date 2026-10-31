import { escapeDollarKeys } from "@shared/dollar-keys";
import { Loader2, MessageSquare } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { CommandWhenCard } from "@/components/commands/command-when-card";
import { EmptyState } from "@/components/common/empty-state";
import { FlowEditor } from "@/components/flow/flow-editor";
import { EditorBackLink } from "@/components/layout/editor-back-link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { WorkflowNotEditable } from "@/components/workflows/workflow-not-editable";
import { useEngineScope } from "@/engine/context";
import {
  useChatCommandGroups,
  useChatCommands,
  useCreateChatCommandRequest,
  useUpdateChatCommandRequest,
} from "@/engine/hooks/use-chat-commands";
import { useResourceInstances } from "@/engine/hooks/use-module-resources";
import { useOpenCommandDraft } from "@/hooks/use-command-draft";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import {
  type CommandEditorState,
  clearCommandDraft,
  isCommandDraftDirty,
  NEW_COMMAND_KEY,
  updateCommandDraft,
} from "@/lib/command-drafts";
import { COMMAND_LIST_PATH } from "@/lib/command-editor-route";
import { splitCommandInput } from "@/lib/command-input";
import { commandSteps } from "@/lib/command-steps";
import { commandActionVariables } from "@/lib/command-variables";
import { storedExpressionProblem } from "@/lib/variable-display";
import type { WorkflowTree } from "@/lib/workflow-tree";

/**
 * One chat command, on its own route.
 *
 * The page is the unified step editor (FlowEditor) with the command as its "When" card:
 * what a chatter types, the arguments it captures, the cooldown and who can use it. The
 * steps below are the command's own workflow, so they can pause, wait and check
 * conditions like any workflow's; the engine runs that workflow once the command has
 * matched and passed its checks (see docs/ui/commands.md).
 *
 * Edits collect in the command's draft (lib/command-drafts.ts) rather than being saved as
 * each step closes, as the workflow editor does: the command and its steps are one save,
 * so Save writes both, and Cancel and Back drop the draft, asking first when it has changed.
 */
export default function CommandEditor() {
  const params = useParams<{ engineCommandId?: string }>();
  const engineCommandId = params.engineCommandId ? decodeParam(params.engineCommandId) : undefined;
  const isNew = engineCommandId === undefined;
  const draftKey = engineCommandId ?? NEW_COMMAND_KEY;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { instanceId, isInstanceLoading: instanceLoading } = useEngineScope();
  const { catalogTriggers, catalogActions, actionPresets, loading: catalogLoading } = useWorkflowCatalog();

  const commandsRaw = useChatCommands();
  const groupsRaw = useChatCommandGroups();
  const groups = useMemo(() => groupsRaw ?? [], [groupsRaw]);
  const resourceInstances = useResourceInstances();
  const resourceLabels = useMemo(
    () =>
      resourceInstances ? new Map(resourceInstances.map((inst) => [inst.canonicalId, inst.displayName])) : undefined,
    [resourceInstances]
  );

  const createCommand = useCreateChatCommandRequest();
  const updateCommand = useUpdateChatCommandRequest();

  const existing = commandsRaw?.find((doc) => doc.engineCommandId === engineCommandId);
  const draft = useOpenCommandDraft(draftKey, existing);
  const form = draft?.value;

  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const isDirty = isCommandDraftDirty(draft);

  // Follows the argument pattern as it is typed, so a `{songTitle}` just added to the
  // command name is offerable in the steps below without saving first.
  const argumentPattern = splitCommandInput(form?.command ?? "").argumentPattern;
  const triggerVariables = useMemo(() => commandActionVariables(argumentPattern), [argumentPattern]);

  const edit = useCallback(
    (change: (current: CommandEditorState) => CommandEditorState) => {
      updateCommandDraft(draftKey, change);
    },
    [draftKey]
  );

  const editSteps = useCallback(
    (tree: WorkflowTree) => {
      edit((current) => ({ ...current, flow: { editable: true, tree } }));
    },
    [edit]
  );

  // Nothing is saved as a step closes: Save writes the command and its steps together.
  const keepSteps = useCallback(async () => true, []);

  const discardAndLeave = () => {
    clearCommandDraft(draftKey);
    navigate(COMMAND_LIST_PATH);
  };

  const leave = () => {
    if (isDirty) {
      setConfirmingLeave(true);
      return;
    }
    discardAndLeave();
  };

  async function handleSave() {
    if (!form || !instanceId) {
      return;
    }
    setFormError(null);

    const { command, argumentPattern } = splitCommandInput(form.command);
    if (!command) {
      setFormError("Command name is required.");
      return;
    }

    const expressionProblem = form.flow.editable ? storedExpressionProblem(form.flow.tree.steps) : null;
    if (expressionProblem !== null) {
      setFormError(expressionProblem);
      return;
    }

    const fields = {
      command,
      // Steps that can't be edited here are left as they are, which an absent `steps` means.
      ...(form.flow.editable ? { steps: escapeDollarKeys(commandSteps(form.flow.tree)) as unknown[] } : {}),
      cooldown: form.cooldown,
      priority: form.priority,
      enabled: form.enabled,
      visibility: form.visibility,
      groupIds: form.groupIds,
      usernames: form.usernames,
      argumentPattern,
    };

    // A command deleted from elsewhere while this page was open leaves nothing to update.
    // Falling through to create would quietly resurrect it under a new engine id.
    if (!isNew && !existing) {
      setFormError("This command no longer exists — it was deleted while you were editing it.");
      return;
    }

    setSaving(true);
    try {
      if (existing) {
        await updateCommand({ ...fields, engineCommandId: existing.engineCommandId });
        toast({ title: "Command updated" });
      } else {
        await createCommand(fields);
        toast({ title: "Command created" });
      }
      discardAndLeave();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  if (instanceLoading || catalogLoading || commandsRaw === undefined || groupsRaw === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="p-8">
        <EmptyState
          icon={MessageSquare}
          title="This command isn't here any more"
          description="It was deleted, or the link is from another instance."
          action={{ label: "Back to commands", onClick: () => navigate(COMMAND_LIST_PATH) }}
        />
      </div>
    );
  }

  const { command: commandWord } = splitCommandInput(form.command);
  const whenCard = <CommandWhenCard value={form} groups={groups} onChange={edit} defaultExpanded={isNew} />;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-2 py-2 sm:h-16 sm:px-4 sm:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <EditorBackLink label="commands" onClick={leave} />
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold leading-tight">{isNew ? "New command" : "Edit command"}</h1>
            <p className="truncate font-mono text-[13px] text-muted-foreground">
              {commandWord ? `!${form.command.trim().replace(/^!/, "")}` : "Unnamed"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" className="hidden sm:inline-flex" onClick={leave} disabled={saving}>
            Cancel
          </Button>
          <Button className="h-11 sm:h-10" onClick={handleSave} disabled={saving} data-testid="button-save-command">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isNew ? "Create command" : "Save changes"}
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-16 pt-6 sm:px-8 sm:pt-8">
          {formError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}

          {existing?.workflowError && (
            <div
              className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="text-command-workflow-error"
            >
              The engine couldn't set up this command's steps: {existing.workflowError}. Save the command to try again.
            </div>
          )}

          {form.flow.editable ? (
            <FlowEditor
              tree={form.flow.tree}
              onChange={editSteps}
              onCommit={keepSteps}
              catalogTriggers={catalogTriggers}
              catalogActions={catalogActions}
              catalogLoading={catalogLoading}
              actionPresets={actionPresets}
              resourceLabels={resourceLabels}
              when={whenCard}
              triggerVariables={triggerVariables}
            />
          ) : (
            <>
              {whenCard}
              <WorkflowNotEditable reason={form.flow.reason} />
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Steps run in order each time someone uses the command. Type {"{"} in a text field to use what the command
            captured, like the chatter's name or an argument, or what an earlier step handed back.
          </p>
        </div>
      </div>

      <AlertDialog open={confirmingLeave} onOpenChange={setConfirmingLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes to this command?</AlertDialogTitle>
            <AlertDialogDescription>
              {isNew
                ? "The command is not created, and nothing is kept."
                : "The command goes back to how it was when you opened it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={discardAndLeave}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A route segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
function decodeParam(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
