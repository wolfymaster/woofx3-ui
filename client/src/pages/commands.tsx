import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ActionStep } from "@woofx3/api";
import { useAction, useQuery } from "convex/react";
import {
  AlertTriangle,
  Clock,
  Globe,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Users,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import {
  COMMAND_GROUP_NEW_ROUTE,
  COMMAND_GROUPS_PATH,
  COMMAND_LIST_PATH,
  COMMAND_NEW_ROUTE,
  commandEditorPath,
  commandGroupEditorPath,
} from "@/lib/command-editor-route";
import { unescapeDollarKeys } from "@/lib/dollar-keys";
import { groupLabel, sortGroups } from "@/lib/group-display";
import { cn } from "@/lib/utils";
import type { ActionPreset } from "@/lib/workflow-presets";
import { actionStepLabel } from "@/lib/workflow-presets-json";

type CommandDoc = Doc<"chatCommands">;
type GroupDoc = Doc<"chatCommandGroups">;

/**
 * What a command does, for a row that shows no detail: the one action it runs,
 * or how many. A command with none only announces itself for workflows.
 */
function summarizeActions(actions: unknown[], actionPresets: ActionPreset[]): ReactNode {
  const steps = unescapeDollarKeys(actions) as ActionStep[];
  if (steps.length === 0) {
    return <span className="italic">trigger only</span>;
  }
  if (steps.length === 1) {
    const step = steps[0];
    const name = actionStepLabel(step, actionPresets);
    return <span title={name}>{truncate(name)}</span>;
  }
  return `${steps.length} actions`;
}

function truncate(text: string, max = 60): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function CommandTableSkeleton() {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Command</TableHead>
            <TableHead>Runs</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead>Cooldown</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholder; the list never reorders
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-48" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-12" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-10" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/**
 * The commands list and the groups list, each on its own route.
 *
 * They read as two tabs of one screen, but the tabs are links rather than local state:
 * the group pages need somewhere definite to go back to, and a bookmark or a reload
 * lands where it left off.
 */
export default function Commands() {
  const [location] = useLocation();
  const { instance, isLoading: instanceLoading } = useInstance();
  const showingGroups = location.startsWith(COMMAND_GROUPS_PATH);

  const commandsRaw = useQuery(api.chatCommands.list, instance ? { instanceId: instance._id } : "skip");
  const groupsRaw = useQuery(api.chatCommandGroups.list, instance ? { instanceId: instance._id } : "skip");
  const commands = commandsRaw ?? [];
  const groups = groupsRaw ?? [];

  const commandsLoading = instanceLoading || commandsRaw === undefined;
  const groupsLoading = instanceLoading || groupsRaw === undefined;

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Chat Commands"
        description="Manage chat commands, permission groups, and who can trigger them."
      />

      <nav className="mb-6 flex w-fit items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        <TabLink href={COMMAND_LIST_PATH} isActive={!showingGroups} testId="tab-commands">
          Commands
        </TabLink>
        <TabLink href={COMMAND_GROUPS_PATH} isActive={showingGroups} testId="tab-groups">
          Groups
        </TabLink>
      </nav>

      {showingGroups ? (
        <GroupsTab instanceId={instance?._id} groups={groups} commands={commands} isLoading={groupsLoading} />
      ) : (
        <CommandsTab instanceId={instance?._id} commands={commands} isLoading={commandsLoading} />
      )}
    </div>
  );
}

/** One of the two list routes, styled as the tab it reads as. */
function TabLink({
  href,
  isActive,
  testId,
  children,
}: {
  href: string;
  isActive: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      data-testid={testId}
      className={cn(
        "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium",
        isActive ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Commands tab
// ---------------------------------------------------------------------------

function CommandsTab({
  instanceId,
  commands,
  isLoading,
}: {
  instanceId: Id<"instances"> | undefined;
  commands: CommandDoc[];
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { actionPresets } = useWorkflowCatalog();
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CommandDoc | null>(null);

  const updateCommand = useAction(api.chatCommandActions.updateCommand);
  const deleteCommand = useAction(api.chatCommandActions.deleteCommand);

  const filteredCommands = searchQuery.trim()
    ? commands.filter((c) => c.command.toLowerCase().includes(searchQuery.toLowerCase()))
    : commands;

  const sortedCommands = [...filteredCommands].sort((a, b) => a.command.localeCompare(b.command));

  async function handleDelete() {
    if (!deleteTarget || !instanceId) {
      return;
    }
    try {
      await deleteCommand({ instanceId, engineCommandId: deleteTarget.engineCommandId });
      toast({ title: "Command deleted" });
    } catch (err: unknown) {
      toast({
        title: "Failed to delete command",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
    setDeleteTarget(null);
  }

  async function handleToggleEnabled(cmd: CommandDoc) {
    if (!instanceId) {
      return;
    }
    try {
      await updateCommand({
        instanceId,
        engineCommandId: cmd.engineCommandId,
        command: cmd.command,
        actions: cmd.actions ?? [],
        cooldown: cmd.cooldown,
        priority: cmd.priority,
        enabled: !cmd.enabled,
        visibility: cmd.visibility,
        groupIds: cmd.groupIds,
        usernames: cmd.usernames,
        argumentPattern: cmd.argumentPattern ?? "",
      });
    } catch (err: unknown) {
      toast({
        title: "Failed to update command",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search commands..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => navigate(COMMAND_NEW_ROUTE)} disabled={!instanceId} data-testid="button-add-command">
          <Plus className="h-4 w-4 mr-2" />
          Add Command
        </Button>
      </div>

      {isLoading ? (
        <CommandTableSkeleton />
      ) : sortedCommands.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No commands found"
          description={searchQuery ? "Try adjusting your search." : "Create your first chat command to get started."}
          action={!searchQuery ? { label: "Add Command", onClick: () => navigate(COMMAND_NEW_ROUTE) } : undefined}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Command</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>Cooldown</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCommands.map((cmd) => (
                <TableRow key={cmd._id}>
                  <TableCell className="font-mono font-medium">
                    !{cmd.command}
                    {cmd.argumentPattern ? (
                      <span className="text-muted-foreground font-normal"> {cmd.argumentPattern}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[280px] text-muted-foreground">
                    {summarizeActions(cmd.actions ?? [], actionPresets)}
                  </TableCell>
                  <TableCell>
                    {cmd.visibility === "public" ? (
                      <Badge variant="secondary" className="gap-1">
                        <Globe className="h-3 w-3" />
                        Public
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="gap-1">
                          <Lock className="h-3 w-3" />
                          Restricted
                        </Badge>
                        {cmd.groupIds.length === 0 && cmd.usernames.length === 0 && (
                          <span title="No groups or usernames granted — invocable by no one">
                            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{cmd.cooldown}s</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(cmd)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {cmd.enabled ? (
                        <ToggleRight className="h-5 w-5 text-primary" />
                      ) : (
                        <ToggleLeft className="h-5 w-5" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => navigate(commandEditorPath(cmd.engineCommandId))}
                        aria-label={`Edit !${cmd.command}`}
                        data-testid={`edit-command-${cmd.engineCommandId}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(cmd)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Command</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteTarget ? `!${deleteTarget.command}` : "this command"}? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Groups tab
// ---------------------------------------------------------------------------

function GroupsTab({
  instanceId,
  groups,
  commands,
  isLoading,
}: {
  instanceId: Id<"instances"> | undefined;
  groups: GroupDoc[];
  commands: CommandDoc[];
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [deleteTarget, setDeleteTarget] = useState<GroupDoc | null>(null);

  const deleteGroup = useAction(api.chatCommandActions.deleteGroup);

  // No server-side "used by N commands" lookup exists — computed client-side
  // from the already-loaded commands list, per docs/services/commands-ui.md.
  const usageByGroupId = useMemo(() => {
    const map = new Map<string, number>();
    for (const cmd of commands) {
      for (const groupId of cmd.groupIds) {
        map.set(groupId, (map.get(groupId) ?? 0) + 1);
      }
    }
    return map;
  }, [commands]);

  async function handleDelete() {
    if (!deleteTarget || !instanceId) {
      return;
    }
    try {
      await deleteGroup({ instanceId, engineGroupId: deleteTarget.engineGroupId });
      toast({ title: "Group deleted" });
    } catch (err: unknown) {
      toast({
        title: "Failed to delete group",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
    setDeleteTarget(null);
  }

  const usageCount = deleteTarget ? (usageByGroupId.get(deleteTarget.engineGroupId) ?? 0) : 0;

  // Built-in groups are seeded by the engine and cannot be renamed or deleted.
  // Membership of all but "everyone" is owned by the platform membership sync,
  // so a hand edit is reverted on that chatter's next message — their page is a
  // read-only roster instead of an editor that silently loses writes.
  const builtInGroups = useMemo(() => sortGroups(groups.filter((g) => g.isBuiltIn)), [groups]);
  const customGroups = useMemo(() => sortGroups(groups.filter((g) => !g.isBuiltIn)), [groups]);

  return (
    <div>
      <div className="flex items-center justify-end mb-6">
        <Button onClick={() => navigate(COMMAND_GROUP_NEW_ROUTE)} disabled={!instanceId} data-testid="button-add-group">
          <Plus className="h-4 w-4 mr-2" />
          Add Group
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Used by</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 3 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholder; the list never reorders
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No groups found"
          description="Built-in groups are seeded by the engine for every application, so this usually means the instance hasn't synced yet. Create a custom group, or check the engine connection in Settings."
          action={{ label: "Add Group", onClick: () => navigate(COMMAND_GROUP_NEW_ROUTE) }}
        />
      ) : (
        <div className="space-y-8">
          {builtInGroups.length > 0 && (
            <section>
              <div className="mb-2">
                <h3 className="text-sm font-semibold">Built-in</h3>
                <p className="text-xs text-muted-foreground">
                  Seeded automatically and kept up to date from chat. They can't be renamed, deleted, or edited by hand.
                </p>
              </div>
              <GroupTable groups={builtInGroups} usageByGroupId={usageByGroupId} />
            </section>
          )}

          <section>
            {builtInGroups.length > 0 && (
              <div className="mb-2">
                <h3 className="text-sm font-semibold">Custom</h3>
                <p className="text-xs text-muted-foreground">Groups you create and whose members you manage.</p>
              </div>
            )}
            {customGroups.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No custom groups yet. Create one to grant a set of usernames access to restricted commands.
              </Card>
            ) : (
              <GroupTable groups={customGroups} usageByGroupId={usageByGroupId} onDelete={setDeleteTarget} />
            )}
          </section>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"?{" "}
              {usageCount > 0
                ? `It's currently referenced by ${usageCount} command${usageCount === 1 ? "" : "s"} — deleting it won't touch those commands, but the group will no longer grant anyone access through them.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * One group table. Every row opens the group's own page, where its name, description and
 * members live; that page decides what of them is editable, since a built-in group is
 * seeded by the engine and refuses both a rename and a delete. Delete stays here on the
 * row, because it acts on the list rather than on what the page shows.
 */
function GroupTable({
  groups,
  usageByGroupId,
  onDelete,
}: {
  groups: GroupDoc[];
  usageByGroupId: Map<string, number>;
  onDelete?: (group: GroupDoc) => void;
}) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Used by</TableHead>
            <TableHead className={onDelete ? "w-[160px]" : "w-[120px]"}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const usage = usageByGroupId.get(group.engineGroupId) ?? 0;
            // "everyone" matches every user implicitly through a wildcard and has no
            // membership rows at all, so its page would show an empty roster implying
            // nobody is in it.
            const hasRoster = group.name !== "everyone";
            const href = commandGroupEditorPath(group.engineGroupId);
            return (
              <TableRow key={group._id} data-testid={`group-row-${group.engineGroupId}`}>
                <TableCell className="font-medium">
                  <Link href={href} className="hover:underline" data-testid={`open-group-${group.engineGroupId}`}>
                    {groupLabel(group)}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[320px]">
                  {group.description ? truncate(group.description) : <span className="italic">—</span>}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {usage} command{usage === 1 ? "" : "s"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {hasRoster ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={href}>
                          <Users className="h-3.5 w-3.5 mr-1.5" />
                          {onDelete ? "Members" : "View"}
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground italic px-2">Everyone</span>
                    )}
                    {onDelete && (
                      <>
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                          <Link href={href} aria-label={`Edit ${group.name}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => onDelete(group)}
                          aria-label={`Delete ${group.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
