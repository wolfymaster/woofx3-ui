import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { AlertTriangle, Loader2, MessageSquare, Shield, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { CommandStepsEditor } from "@/components/commands/command-steps-editor";
import { GroupMultiSelect } from "@/components/commands/group-multi-select";
import { EmptyState } from "@/components/common/empty-state";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useOpenCommandDraft } from "@/hooks/use-command-draft";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import {
  type CommandEditorState,
  type CommandVisibility,
  clearCommandDraft,
  isCommandDraftDirty,
  NEW_COMMAND_KEY,
  updateCommandDraft,
} from "@/lib/command-drafts";
import { COMMAND_LIST_PATH, commandStepAlertPath } from "@/lib/command-editor-route";
import { splitCommandInput } from "@/lib/command-input";
import { escapeDollarKeys } from "@/lib/dollar-keys";

/**
 * One chat command, on its own route.
 *
 * A command is as much to configure as an alert is — a name, an ordered list of steps
 * with their own settings, and who may run it — so it is edited on a page rather than in
 * a dialog. Its steps are the same numbered rows the Alerts screen uses, and a step with
 * alert content opens that content on its own route too.
 *
 * Edits collect in the command's draft (lib/command-drafts.ts) rather than in page state,
 * so they survive the trip to the alert editor and back. Nothing is written until Save;
 * Cancel and Back drop the draft, asking first when it has changed.
 */
export default function CommandEditor() {
  const params = useParams<{ engineCommandId?: string }>();
  const engineCommandId = params.engineCommandId ? decodeParam(params.engineCommandId) : undefined;
  const isNew = engineCommandId === undefined;
  const draftKey = engineCommandId ?? NEW_COMMAND_KEY;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { instance, isLoading: instanceLoading } = useInstance();
  const { actionPresets, loading: catalogLoading } = useWorkflowCatalog();

  const commandsRaw = useQuery(api.chatCommands.list, instance ? { instanceId: instance._id } : "skip");
  const groupsRaw = useQuery(api.chatCommandGroups.list, instance ? { instanceId: instance._id } : "skip");
  const groups = useMemo(() => groupsRaw ?? [], [groupsRaw]);

  const createCommand = useAction(api.chatCommandActions.createCommand);
  const updateCommand = useAction(api.chatCommandActions.updateCommand);

  const existing = commandsRaw?.find((doc) => doc.engineCommandId === engineCommandId);
  const draft = useOpenCommandDraft(draftKey, existing);
  const form = draft?.value;

  const [userInput, setUserInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const isDirty = isCommandDraftDirty(draft);

  // Follows the argument pattern as it is typed, so a `{songTitle}` just added to the
  // command name is offerable in the steps below without saving first.
  const argumentPattern = splitCommandInput(form?.command ?? "").argumentPattern;

  const edit = (change: (current: CommandEditorState) => CommandEditorState) => {
    updateCommandDraft(draftKey, change);
  };

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

  function addUsername() {
    const name = userInput.trim().toLowerCase().replace(/^@/, "");
    if (!name) {
      return;
    }
    setUserInput("");
    edit((current) =>
      current.usernames.includes(name) ? current : { ...current, usernames: [...current.usernames, name] }
    );
  }

  async function handleSave() {
    if (!form || !instance) {
      return;
    }
    setFormError(null);

    const { command, argumentPattern } = splitCommandInput(form.command);
    if (!command) {
      setFormError("Command name is required.");
      return;
    }

    const fields = {
      instanceId: instance._id,
      command,
      actions: escapeDollarKeys(form.actions) as unknown[],
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
  const restrictedWithNoAccess =
    form.visibility === "restricted" && form.groupIds.length === 0 && form.usernames.length === 0;

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
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-10 px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
          {formError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}

          <Section title="Command" description="What a chatter types to run it.">
            <div className="grid gap-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                  !
                </span>
                <Input
                  id="cmd-name"
                  placeholder="sr {songTitle}"
                  className="pl-6 font-mono"
                  value={form.command}
                  onChange={(e) => edit((current) => ({ ...current, command: e.target.value }))}
                  data-testid="input-command-name"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Everything up to the first space is the command name. Add {"{variableName}"} after it to capture the
                rest of the message as an argument — e.g. "sr {"{songTitle}"}" passes what the user types after !sr as
                songTitle.
              </p>
            </div>
          </Section>

          <Section title="Then">
            <CommandStepsEditor
              actions={form.actions}
              onChange={(actions) => edit((current) => ({ ...current, actions }))}
              actionPresets={actionPresets}
              argumentPattern={argumentPattern}
              alertEditorHref={(actionId) => commandStepAlertPath(engineCommandId, actionId)}
            />
            <p className="text-xs text-muted-foreground">
              Steps run in order. Type {"{"} in a text field to use what the command captured, like the chatter's name
              or an argument, or what an earlier step handed back.
            </p>
          </Section>

          <Section title="Who can use it">
            <div className="grid gap-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Visibility</span>
              </div>
              <Select
                value={form.visibility}
                onValueChange={(value) => edit((current) => ({ ...current, visibility: value as CommandVisibility }))}
              >
                <SelectTrigger data-testid="select-command-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public — anyone can use this command</SelectItem>
                  <SelectItem value="restricted">Restricted — only granted groups/users</SelectItem>
                </SelectContent>
              </Select>

              {form.visibility === "restricted" && (
                <div className="grid gap-3 pl-1">
                  <div className="grid gap-2">
                    <Label>Groups</Label>
                    <GroupMultiSelect
                      groups={groups}
                      selected={form.groupIds}
                      onToggle={(engineGroupId) =>
                        edit((current) => ({
                          ...current,
                          groupIds: current.groupIds.includes(engineGroupId)
                            ? current.groupIds.filter((id) => id !== engineGroupId)
                            : [...current.groupIds, engineGroupId],
                        }))
                      }
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="cmd-usernames">Specific users</Label>
                    <div className="flex gap-2">
                      <Input
                        id="cmd-usernames"
                        placeholder="username"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addUsername();
                          }
                        }}
                      />
                      <Button type="button" variant="outline" onClick={addUsername}>
                        Add
                      </Button>
                    </div>
                    {form.usernames.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {form.usernames.map((user) => (
                          <Badge key={user} variant="secondary" className="gap-1 pr-1">
                            {user}
                            <button
                              type="button"
                              onClick={() =>
                                edit((current) => ({
                                  ...current,
                                  usernames: current.usernames.filter((u) => u !== user),
                                }))
                              }
                              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                              aria-label={`Remove ${user}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {restrictedWithNoAccess && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-500">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        This command is restricted but has no groups or users granted — it will be invocable by no one.
                        Add at least one group or username, or switch it to Public.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          <Section title="How it runs">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="cmd-cooldown">Cooldown (seconds)</Label>
                <Input
                  id="cmd-cooldown"
                  type="number"
                  min={0}
                  value={form.cooldown}
                  onChange={(e) => edit((current) => ({ ...current, cooldown: Number(e.target.value) }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cmd-priority">Priority (optional)</Label>
                <Input
                  id="cmd-priority"
                  type="number"
                  value={form.priority}
                  onChange={(e) => edit((current) => ({ ...current, priority: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-4">
              <Switch
                id="cmd-enabled"
                checked={form.enabled}
                onCheckedChange={(checked) => edit((current) => ({ ...current, enabled: checked }))}
              />
              <Label htmlFor="cmd-enabled">Enabled</Label>
            </div>
          </Section>
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

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-5 gap-y-2 sm:grid-cols-[120px_minmax(0,1fr)]">
      <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:pt-2">{title}</h2>
      <div className="flex flex-col gap-2">
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        {children}
      </div>
    </section>
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
