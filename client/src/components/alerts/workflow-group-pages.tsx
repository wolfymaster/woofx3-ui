import { Layers, Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useAddWorkflowGroupMembersRequest,
  useCreateWorkflowGroupRequest,
  useDeleteWorkflowGroupRequest,
  useRemoveWorkflowGroupMembersRequest,
  useSetWorkflowGroupEnabledRequest,
  useUpdateWorkflowGroupRequest,
  useWorkflowGroups,
} from "@/engine/hooks/use-workflow-groups";
import { useWorkflows } from "@/engine/hooks/use-workflows";
import type { WorkflowGroup } from "@/engine/types";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { decodeSegment } from "@/lib/route-subpath";
import {
  cardGroupIds,
  cardsInGroup,
  cardsReleasedBy,
  cardWorkflowIds,
  type GroupableCard,
  groupableCards,
} from "@/lib/workflow-groups";

/** Where the group pages live, below the Alerts route. Must match the reserved segment in pages/alerts.tsx. */
export const ALERT_GROUPS_PATH = "/stream/alerts/groups";
export const NEW_ALERT_GROUP_SEGMENT = "new";

export const SWITCH_EXPLAINER =
  "Turning this on switches on every trigger in it. Turning it off puts each one back how it was, unless another group that is on still includes it.";

/** Every trigger card on the instance; undefined until the triggers have loaded. */
function useGroupableCards(): GroupableCard[] | undefined {
  const workflows = useWorkflows();
  const { triggerPresets } = useWorkflowCatalog();
  return useMemo(
    () => (workflows === undefined ? undefined : groupableCards(workflows, triggerPresets)),
    [workflows, triggerPresets]
  );
}

function triggerCount(count: number): string {
  return `${count} trigger${count === 1 ? "" : "s"}`;
}

function errorText(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

/** Switches a group from a list row or the editor, saying so when it fails. */
function GroupSwitch({ group, id }: { group: WorkflowGroup; id?: string }) {
  const setEnabled = useSetWorkflowGroupEnabledRequest();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Switch
      id={id}
      checked={group.enabled}
      disabled={pending}
      aria-label={`${group.enabled ? "Turn off" : "Turn on"} ${group.name}`}
      onCheckedChange={async (enabled) => {
        setPending(true);
        try {
          await setEnabled(group.engineGroupId, enabled);
        } catch (err: unknown) {
          toast({ title: "Couldn't switch the group", description: errorText(err), variant: "destructive" });
        } finally {
          setPending(false);
        }
      }}
      data-testid={`switch-alert-group-${group.engineGroupId}`}
    />
  );
}

/** The group pages for the path segments below ALERT_GROUPS_PATH: the list, or one group ("new" for a new one). */
export function WorkflowGroupPages({ route }: { route: readonly string[] }) {
  const [segment] = route;
  if (segment === undefined) {
    return <WorkflowGroupList />;
  }
  return (
    <WorkflowGroupEditor
      key={segment}
      engineGroupId={segment === NEW_ALERT_GROUP_SEGMENT ? null : decodeSegment(segment)}
    />
  );
}

/** Every alert group, with its member count and switch. */
function WorkflowGroupList() {
  const groups = useWorkflowGroups();
  const cards = useGroupableCards();
  const [, navigate] = useLocation();
  const sorted = useMemo(() => [...(groups ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [groups]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Alert groups"
        description="Sets of triggers you switch on and off together, like a holiday set or a sponsor set."
      />
      <div>
        <Button
          onClick={() => navigate(`${ALERT_GROUPS_PATH}/${NEW_ALERT_GROUP_SEGMENT}`)}
          data-testid="button-new-alert-group"
        >
          <Plus className="mr-2 h-4 w-4" />
          New group
        </Button>
      </div>
      {groups === undefined ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No alert groups yet"
          description="Make a group, add the triggers that belong together, and switch them all at once."
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {sorted.map((group) => (
            <li key={group.engineGroupId} className="flex items-center justify-between gap-4 px-4 py-3">
              <Link href={`${ALERT_GROUPS_PATH}/${encodeURIComponent(group.engineGroupId)}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{group.name}</span>
                {cards !== undefined && (
                  <span className="text-[13px] text-muted-foreground">
                    {triggerCount(cardsInGroup(cards, group.engineGroupId).length)}
                  </span>
                )}
              </Link>
              <GroupSwitch group={group} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] text-muted-foreground">{SWITCH_EXPLAINER}</p>
    </div>
  );
}

/**
 * One alert group: its name and description, written on Save, and its triggers,
 * added and removed as each change is made.
 */
function WorkflowGroupEditor({ engineGroupId }: { engineGroupId: string | null }) {
  const isNew = engineGroupId === null;
  const groups = useWorkflowGroups();
  const cards = useGroupableCards();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createGroup = useCreateWorkflowGroupRequest();
  const updateGroup = useUpdateWorkflowGroupRequest();
  const deleteGroup = useDeleteWorkflowGroupRequest();
  const existing = groups?.find((group) => group.engineGroupId === engineGroupId);

  const [form, setForm] = useState<{ name: string; description: string } | null>(null);
  useEffect(() => {
    if (form !== null) {
      return;
    }
    if (isNew) {
      setForm({ name: "", description: "" });
    } else if (existing) {
      setForm({ name: existing.name, description: existing.description });
    }
  }, [form, isNew, existing]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (groups === undefined) {
    return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  }
  if (!form || (!isNew && !existing)) {
    return (
      <EmptyState
        icon={Layers}
        title="This group isn't here any more"
        description="It was deleted, or the link is from another engine."
        action={{ label: "Back to groups", onClick: () => navigate(ALERT_GROUPS_PATH) }}
      />
    );
  }

  async function save() {
    if (!form) {
      return;
    }
    const name = form.name.trim();
    if (!name) {
      setFormError("Give the group a name.");
      return;
    }
    const clash = (groups ?? []).find(
      (group) => group.name.toLowerCase() === name.toLowerCase() && group.engineGroupId !== engineGroupId
    );
    if (clash) {
      setFormError(`A group called "${clash.name}" already exists.`);
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const text = { name, description: form.description.trim() };
      if (existing) {
        await updateGroup(existing.engineGroupId, text);
        toast({ title: "Group saved" });
      } else {
        const created = await createGroup(text);
        toast({ title: "Group created" });
        navigate(`${ALERT_GROUPS_PATH}/${encodeURIComponent(created.engineGroupId)}`);
      }
    } catch (err: unknown) {
      setFormError(errorText(err) ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing) {
      return;
    }
    try {
      await deleteGroup(existing.engineGroupId);
      toast({ title: "Group deleted" });
      navigate(ALERT_GROUPS_PATH);
    } catch (err: unknown) {
      toast({ title: "Couldn't delete the group", description: errorText(err), variant: "destructive" });
    }
  }

  const changing = existing ? cardsReleasedBy(existing, groups, cards ?? []) : 0;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={isNew ? "New alert group" : existing?.name || "Alert group"}
        description="Triggers you switch on and off together."
      />
      {formError && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      <Section title="Group">
        <div className="grid gap-2">
          <Label htmlFor="alert-group-name">Name</Label>
          <Input
            id="alert-group-name"
            placeholder="Holiday"
            value={form.name}
            maxLength={100}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid="input-alert-group-name"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="alert-group-description">Description (optional)</Label>
          <Textarea
            id="alert-group-description"
            value={form.description}
            maxLength={500}
            rows={2}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving} data-testid="button-save-alert-group">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isNew ? "Create group" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={() => navigate(ALERT_GROUPS_PATH)}>
            Back to groups
          </Button>
        </div>
      </Section>
      {existing && (
        <>
          <Section title="Switch">
            <div className="flex items-center gap-3">
              <GroupSwitch group={existing} id="alert-group-switch" />
              <Label htmlFor="alert-group-switch">{existing.enabled ? "On" : "Off"}</Label>
            </div>
            <p className="text-[13px] text-muted-foreground">{SWITCH_EXPLAINER}</p>
          </Section>
          <Section title="Triggers">
            <p className="text-[13px] text-muted-foreground">
              Each change here is saved straight away. Adding a trigger to a group that is on switches it on.
            </p>
            <GroupMembers group={existing} cards={cards ?? []} />
          </Section>
          <Section title="Delete">
            <div>
              <Button
                variant="outline"
                onClick={() => setConfirmingDelete(true)}
                data-testid="button-delete-alert-group"
              >
                Delete group
              </Button>
            </div>
          </Section>
        </>
      )}
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this group?</AlertDialogTitle>
            <AlertDialogDescription>
              {changing === 0
                ? "The triggers in it stay as they are; only the group goes."
                : `${triggerCount(changing)} go${changing === 1 ? "es" : ""} back to how ${changing === 1 ? "it was" : "they were"} before this group switched ${changing === 1 ? "it" : "them"} on. The triggers themselves are kept.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete group</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A card's name in a list: what happened, and when it is narrowed, under what conditions. */
function CardLabel({ card }: { card: GroupableCard }) {
  return (
    <span className="min-w-0">
      <span className="block truncate">{card.eventLabel}</span>
      <span className="block truncate text-[13px] text-muted-foreground">
        {card.conditionsLabel === "" ? "Every time" : card.conditionsLabel}
      </span>
    </span>
  );
}

function GroupMembers({ group, cards }: { group: WorkflowGroup; cards: readonly GroupableCard[] }) {
  const addMembers = useAddWorkflowGroupMembersRequest();
  const removeMembers = useRemoveWorkflowGroupMembersRequest();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const inGroup = cardsInGroup(cards, group.engineGroupId);
  const notInGroup = cards.filter((card) => !cardGroupIds(card).includes(group.engineGroupId));

  async function change(write: () => Promise<unknown>, failure: string) {
    setPending(true);
    try {
      await write();
    } catch (err: unknown) {
      toast({ title: failure, description: errorText(err), variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  async function addChosen() {
    const ids = notInGroup.filter((card) => chosen.has(card.key)).flatMap(cardWorkflowIds);
    if (ids.length > 0) {
      await change(() => addMembers(group.engineGroupId, ids), "Couldn't add the triggers");
    }
    setPicking(false);
    setChosen(new Set());
  }

  return (
    <div className="grid gap-3">
      {inGroup.length === 0 ? (
        <p className="py-2 text-sm italic text-muted-foreground">No triggers in this group yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {inGroup.map((card) => (
            <li key={card.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <CardLabel card={card} />
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                aria-label={`Remove ${card.eventLabel} from the group`}
                onClick={() =>
                  change(() => removeMembers(group.engineGroupId, cardWorkflowIds(card)), "Couldn't remove the trigger")
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button
          variant="outline"
          onClick={() => setPicking(true)}
          disabled={pending}
          data-testid="button-add-alert-group-triggers"
        >
          Add triggers
        </Button>
      </div>
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add triggers to {group.name}</DialogTitle>
          </DialogHeader>
          {notInGroup.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every trigger is already in this group.</p>
          ) : (
            <ul className="max-h-[50vh] divide-y overflow-auto rounded-md border">
              {notInGroup.map((card) => (
                <li key={card.key}>
                  <label htmlFor={`pick-${card.key}`} className="flex cursor-pointer items-center gap-3 px-3 py-2">
                    <Checkbox
                      id={`pick-${card.key}`}
                      checked={chosen.has(card.key)}
                      onCheckedChange={(checked) => {
                        const next = new Set(chosen);
                        if (checked === true) {
                          next.add(card.key);
                        } else {
                          next.delete(card.key);
                        }
                        setChosen(next);
                      }}
                    />
                    <CardLabel card={card} />
                  </label>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
            <Button onClick={addChosen} disabled={chosen.size === 0 || pending}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
