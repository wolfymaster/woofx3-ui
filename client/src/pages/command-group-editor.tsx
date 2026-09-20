import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { Loader2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { COMMAND_GROUPS_PATH } from "@/lib/command-editor-route";
import { groupLabel } from "@/lib/group-display";

type GroupDoc = Doc<"chatCommandGroups">;

interface GroupFormState {
  name: string;
  description: string;
}

const emptyForm: GroupFormState = { name: "", description: "" };

/**
 * One permission group, on its own route: its name and description, and — once it
 * exists — who belongs to it.
 *
 * Name and description are written on Save. Membership is not: each add and remove is
 * its own engine call, applied as it is made, because that is the only shape the engine
 * offers for it. The page says so rather than letting the Save button imply otherwise.
 */
export default function CommandGroupEditor() {
  const params = useParams<{ engineGroupId?: string }>();
  const engineGroupId = params.engineGroupId ? decodeParam(params.engineGroupId) : undefined;
  const isNew = engineGroupId === undefined;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { instance, isLoading: instanceLoading } = useInstance();

  const groupsRaw = useQuery(api.chatCommandGroups.list, instance ? { instanceId: instance._id } : "skip");
  const commandsRaw = useQuery(api.chatCommands.list, instance ? { instanceId: instance._id } : "skip");

  const createGroup = useAction(api.chatCommandActions.createGroup);
  const updateGroup = useAction(api.chatCommandActions.updateGroup);

  const existing = groupsRaw?.find((doc) => doc.engineGroupId === engineGroupId);
  // Built-in groups are seeded by the engine and cannot be renamed or deleted, so this
  // page shows them rather than offering edits the engine would refuse.
  const readOnly = !!existing?.isBuiltIn;

  const [form, setForm] = useState<GroupFormState | null>(null);
  const [openedAs, setOpenedAs] = useState<string | null>(null);
  useEffect(() => {
    if (form !== null) {
      return;
    }
    const initial = isNew ? emptyForm : existing && { name: existing.name, description: existing.description };
    if (initial) {
      setForm(initial);
      setOpenedAs(JSON.stringify(initial));
    }
  }, [form, isNew, existing]);

  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const isDirty = form !== null && openedAs !== null && JSON.stringify(form) !== openedAs;

  const leave = () => {
    if (isDirty && !readOnly) {
      setConfirmingLeave(true);
      return;
    }
    navigate(COMMAND_GROUPS_PATH);
  };

  async function handleSave() {
    if (!form || !instance) {
      return;
    }
    setFormError(null);
    const name = form.name.trim();
    if (!name) {
      setFormError("Group name is required.");
      return;
    }
    // `groups` is unique on (application_id, name) in the engine, and the built-ins
    // already occupy everyone/subscriber/vip/moderator/broadcaster. Without this the
    // create is still refused, but as a raw constraint error.
    const clash = (groupsRaw ?? []).find(
      (g) => g.name.toLowerCase() === name.toLowerCase() && g.engineGroupId !== engineGroupId
    );
    if (clash) {
      setFormError(
        clash.isBuiltIn
          ? `"${clash.name}" is a built-in group. Pick a different name.`
          : `A group called "${clash.name}" already exists.`
      );
      return;
    }

    setSaving(true);
    try {
      if (existing) {
        await updateGroup({
          instanceId: instance._id,
          engineGroupId: existing.engineGroupId,
          name,
          description: form.description.trim() || undefined,
        });
        toast({ title: "Group updated" });
      } else {
        await createGroup({
          instanceId: instance._id,
          name,
          description: form.description.trim() || undefined,
        });
        toast({ title: "Group created" });
      }
      navigate(COMMAND_GROUPS_PATH);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  if (instanceLoading || groupsRaw === undefined) {
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
          icon={Users}
          title="This group isn't here any more"
          description="It was deleted, or the link is from another instance."
          action={{ label: "Back to groups", onClick: () => navigate(COMMAND_GROUPS_PATH) }}
        />
      </div>
    );
  }

  const usedBy = (commandsRaw ?? []).filter((cmd) => engineGroupId && cmd.groupIds.includes(engineGroupId)).length;
  const title = isNew ? "New group" : readOnly ? groupLabel(existing as GroupDoc) : "Edit group";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-2 py-2 sm:h-16 sm:px-4 sm:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <EditorBackLink label="groups" onClick={leave} />
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold leading-tight">{title}</h1>
            <p className="truncate text-[13px] text-muted-foreground">
              {readOnly
                ? "Built-in group — kept up to date from chat"
                : isNew
                  ? "A set of chatters you can grant restricted commands to"
                  : `Used by ${usedBy} command${usedBy === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" className="hidden sm:inline-flex" onClick={leave} disabled={saving}>
              Cancel
            </Button>
            <Button className="h-11 sm:h-10" onClick={handleSave} disabled={saving} data-testid="button-save-group">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isNew ? "Create group" : "Save changes"}
            </Button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-10 px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
          {formError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}

          <Section title="Group">
            {readOnly ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{groupLabel(existing as GroupDoc)}</dd>
                <dt className="text-muted-foreground">Description</dt>
                <dd>{existing?.description || <span className="italic text-muted-foreground">—</span>}</dd>
                <dt className="text-muted-foreground">Used by</dt>
                <dd>
                  {usedBy} command{usedBy === 1 ? "" : "s"}
                </dd>
              </dl>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="group-name">Name</Label>
                  <Input
                    id="group-name"
                    placeholder="regulars"
                    value={form.name}
                    onChange={(e) => setForm((current) => (current ? { ...current, name: e.target.value } : current))}
                    data-testid="input-group-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="group-description">Description (optional)</Label>
                  <Textarea
                    id="group-description"
                    placeholder="Chatters who have been around a while."
                    value={form.description}
                    onChange={(e) =>
                      setForm((current) => (current ? { ...current, description: e.target.value } : current))
                    }
                    rows={2}
                  />
                </div>
              </>
            )}
          </Section>

          <Section title="Members">
            {isNew ? (
              <p className="text-sm text-muted-foreground">
                Create the group first — its members can be added once it exists.
              </p>
            ) : (
              existing &&
              instance && (
                <>
                  <p className="text-[13px] text-muted-foreground">
                    {readOnly
                      ? "Membership of this group is kept up to date from chat automatically. It is shown here for reference and can't be edited — a manual change would be reverted on that user's next message."
                      : "Membership is by chat username. Each change here is saved straight away, separately from the name and description above."}
                  </p>
                  <GroupMembers instanceId={instance._id} group={existing} />
                </>
              )
            )}
          </Section>
        </div>
      </div>

      <AlertDialog open={confirmingLeave} onOpenChange={setConfirmingLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes to this group?</AlertDialogTitle>
            <AlertDialogDescription>
              {isNew
                ? "The group is not created, and nothing is kept. Members you already added stay as they are."
                : "The name and description go back to how they were when you opened this page. Members you added or removed stay as they are — those were saved as you made them."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate(COMMAND_GROUPS_PATH)}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Who belongs to one group, added and removed a username at a time. */
function GroupMembers({ instanceId, group }: { instanceId: Id<"instances">; group: GroupDoc }) {
  const readOnly = !!group.isBuiltIn;
  const { toast } = useToast();
  const [usernameInput, setUsernameInput] = useState("");
  const [pending, setPending] = useState(false);

  const members = useQuery(api.chatCommandGroups.listMembers, {
    instanceId,
    engineGroupId: group.engineGroupId,
  });

  const addUserToGroup = useAction(api.chatCommandActions.addUserToGroup);
  const removeUserFromGroup = useAction(api.chatCommandActions.removeUserFromGroup);

  async function handleAdd() {
    const username = usernameInput.trim().toLowerCase().replace(/^@/, "");
    if (!username) {
      return;
    }
    setPending(true);
    try {
      await addUserToGroup({ instanceId, engineGroupId: group.engineGroupId, username });
      setUsernameInput("");
    } catch (err: unknown) {
      toast({
        title: "Failed to add member",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  async function handleRemove(username: string) {
    setPending(true);
    try {
      await removeUserFromGroup({ instanceId, engineGroupId: group.engineGroupId, username });
    } catch (err: unknown) {
      toast({
        title: "Failed to remove member",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      {!readOnly && (
        <div className="flex gap-2">
          <Input
            placeholder="username"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            data-testid="input-group-member"
          />
          <Button type="button" variant="outline" onClick={handleAdd} disabled={pending}>
            Add
          </Button>
        </div>
      )}

      {members === undefined ? (
        <div className="grid gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholder; the list never reorders
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <p className="py-2 text-sm italic text-muted-foreground">
          {readOnly ? "Nobody in this group right now." : "No members yet."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {members.map((username) => (
            <Badge key={username} variant="secondary" className={readOnly ? "" : "gap-1 pr-1"}>
              {username}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleRemove(username)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${username}`}
                  disabled={pending}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-5 gap-y-2 sm:grid-cols-[120px_minmax(0,1fr)]">
      <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:pt-2">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
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
