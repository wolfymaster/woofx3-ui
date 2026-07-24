import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Clock,
  Globe,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import {
  Command as ComboBox,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type CommandDoc = Doc<"chatCommands">;
type GroupDoc = Doc<"chatCommandGroups">;
interface AvailableFunction {
  id: string;
  moduleId: string | undefined;
  moduleName: string;
  manifestId: string;
  name: string;
  qualifiedName: string;
  runtime: string;
}

type CommandType = "text" | "function";
type Visibility = "public" | "restricted";

interface CommandFormState {
  command: string;
  type: CommandType;
  typeValue: string;
  cooldown: number;
  priority: number;
  enabled: boolean;
  visibility: Visibility;
  groupIds: string[];
  usernames: string[];
}

const defaultFormState: CommandFormState = {
  command: "",
  type: "text",
  typeValue: "",
  cooldown: 5,
  priority: 0,
  enabled: true,
  visibility: "public",
  groupIds: [],
  usernames: [],
};

function truncate(text: string, max = 60): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

// Everything up to the first space is the command word; everything after is
// the argumentPattern (e.g. "sr {songTitle}" -> command "sr", pattern
// "{songTitle}"). See CommandSnapshot.argumentPattern in @woofx3/api for the
// extraction rule the engine applies at chat-message time.
function splitCommandInput(raw: string): { command: string; argumentPattern: string } {
  const trimmed = raw.trim().replace(/^!/, "");
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed, argumentPattern: "" };
  }
  return {
    command: trimmed.slice(0, spaceIndex),
    argumentPattern: trimmed.slice(spaceIndex + 1).trim(),
  };
}

function joinCommandInput(command: string, argumentPattern: string): string {
  return argumentPattern ? `${command} ${argumentPattern}` : command;
}

function CommandTableSkeleton() {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Command</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Response</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead>Cooldown</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
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

export default function Commands() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const [activeTab, setActiveTab] = useState<"commands" | "groups">("commands");

  const commandsRaw = useQuery(api.chatCommands.list, instance ? { instanceId: instance._id } : "skip");
  const groupsRaw = useQuery(api.chatCommandGroups.list, instance ? { instanceId: instance._id } : "skip");
  const availableFunctionsRaw = useQuery(
    api.chatCommands.listAvailableFunctions,
    instance ? { instanceId: instance._id } : "skip"
  );

  const commands = commandsRaw ?? [];
  const groups = groupsRaw ?? [];
  const availableFunctions = availableFunctionsRaw ?? [];

  const commandsLoading = instanceLoading || commandsRaw === undefined;
  const groupsLoading = instanceLoading || groupsRaw === undefined;

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Chat Commands"
        description="Manage chat commands, permission groups, and who can trigger them."
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "commands" | "groups")} className="space-y-6">
        <TabsList>
          <TabsTrigger value="commands" data-testid="tab-commands">
            Commands
          </TabsTrigger>
          <TabsTrigger value="groups" data-testid="tab-groups">
            Groups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="commands" className="mt-0">
          <CommandsTab
            instanceId={instance?._id}
            commands={commands}
            groups={groups}
            availableFunctions={availableFunctions}
            isLoading={commandsLoading}
          />
        </TabsContent>

        <TabsContent value="groups" className="mt-0">
          <GroupsTab instanceId={instance?._id} groups={groups} commands={commands} isLoading={groupsLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commands tab
// ---------------------------------------------------------------------------

function CommandsTab({
  instanceId,
  commands,
  groups,
  availableFunctions,
  isLoading,
}: {
  instanceId: Id<"instances"> | undefined;
  commands: CommandDoc[];
  groups: GroupDoc[];
  availableFunctions: AvailableFunction[];
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CommandDoc | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommandDoc | null>(null);
  const [formState, setFormState] = useState<CommandFormState>(defaultFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userInput, setUserInput] = useState("");

  const createCommand = useAction(api.chatCommandActions.createCommand);
  const updateCommand = useAction(api.chatCommandActions.updateCommand);
  const deleteCommand = useAction(api.chatCommandActions.deleteCommand);

  const filteredCommands = searchQuery.trim()
    ? commands.filter((c) => c.command.toLowerCase().includes(searchQuery.toLowerCase()))
    : commands;

  const sortedCommands = [...filteredCommands].sort((a, b) => a.command.localeCompare(b.command));

  function openCreateDialog() {
    setEditing(null);
    setFormState(defaultFormState);
    setFormError(null);
    setUserInput("");
    setDialogOpen(true);
  }

  function openEditDialog(cmd: CommandDoc) {
    setEditing(cmd);
    setFormState({
      command: joinCommandInput(cmd.command, cmd.argumentPattern ?? ""),
      type: cmd.type,
      typeValue: cmd.typeValue,
      cooldown: cmd.cooldown,
      priority: cmd.priority,
      enabled: cmd.enabled,
      visibility: cmd.visibility,
      groupIds: cmd.groupIds,
      usernames: cmd.usernames,
    });
    setFormError(null);
    setUserInput("");
    setDialogOpen(true);
  }

  function addUsername() {
    const name = userInput.trim().toLowerCase().replace(/^@/, "");
    if (!name) {
      return;
    }
    if (formState.usernames.includes(name)) {
      setUserInput("");
      return;
    }
    setFormState((s) => ({ ...s, usernames: [...s.usernames, name] }));
    setUserInput("");
  }

  function removeUsername(name: string) {
    setFormState((s) => ({ ...s, usernames: s.usernames.filter((u) => u !== name) }));
  }

  function toggleGroup(engineGroupId: string) {
    setFormState((s) => ({
      ...s,
      groupIds: s.groupIds.includes(engineGroupId)
        ? s.groupIds.filter((id) => id !== engineGroupId)
        : [...s.groupIds, engineGroupId],
    }));
  }

  const restrictedWithNoAccess =
    formState.visibility === "restricted" && formState.groupIds.length === 0 && formState.usernames.length === 0;

  async function handleSave() {
    setFormError(null);

    const { command, argumentPattern } = splitCommandInput(formState.command);
    if (!command) {
      setFormError("Command name is required.");
      return;
    }

    if (formState.type === "function" && !formState.typeValue.trim()) {
      setFormError("Choose a function for this command.");
      return;
    }

    if (!instanceId) {
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateCommand({
          instanceId,
          engineCommandId: editing.engineCommandId,
          command,
          type: formState.type,
          typeValue: formState.typeValue,
          cooldown: formState.cooldown,
          priority: formState.priority,
          enabled: formState.enabled,
          visibility: formState.visibility,
          groupIds: formState.groupIds,
          usernames: formState.usernames,
          argumentPattern,
        });
        toast({ title: "Command updated" });
      } else {
        await createCommand({
          instanceId,
          command,
          type: formState.type,
          typeValue: formState.typeValue,
          cooldown: formState.cooldown,
          priority: formState.priority,
          enabled: formState.enabled,
          visibility: formState.visibility,
          groupIds: formState.groupIds,
          usernames: formState.usernames,
          argumentPattern,
        });
        toast({ title: "Command created" });
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

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
        type: cmd.type,
        typeValue: cmd.typeValue,
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
        <Button onClick={openCreateDialog} disabled={!instanceId}>
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
          action={!searchQuery ? { label: "Add Command", onClick: openCreateDialog } : undefined}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Command</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Response</TableHead>
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
                  <TableCell>
                    <Badge variant={cmd.type === "function" ? "outline" : "default"} className="capitalize">
                      {cmd.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[280px] text-muted-foreground">
                    {cmd.typeValue ? (
                      <span title={cmd.typeValue}>{truncate(cmd.typeValue)}</span>
                    ) : (
                      <span className="italic">trigger only</span>
                    )}
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
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(cmd)}>
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

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Command" : "New Command"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {formError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="cmd-name">Command</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                  !
                </span>
                <Input
                  id="cmd-name"
                  placeholder="sr {songTitle}"
                  className="pl-6 font-mono"
                  value={formState.command}
                  onChange={(e) => setFormState((s) => ({ ...s, command: e.target.value }))}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Everything up to the first space is the command name. Add {"{variableName}"} after it to capture the
                rest of the message as an argument — e.g. "sr {"{songTitle}"}" passes what the user types after !sr as
                songTitle.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cmd-type">Type</Label>
              <Select
                value={formState.type}
                onValueChange={(val) => setFormState((s) => ({ ...s, type: val as CommandType, typeValue: "" }))}
              >
                <SelectTrigger id="cmd-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text response</SelectItem>
                  <SelectItem value="function">Function</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formState.type === "text" && (
              <div className="grid gap-2">
                <Label htmlFor="cmd-response">Response</Label>
                <Textarea
                  id="cmd-response"
                  placeholder="Hello, welcome to the stream! Leave empty for a trigger-only command."
                  value={formState.typeValue}
                  onChange={(e) => setFormState((s) => ({ ...s, typeValue: e.target.value }))}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  {
                    "Supports {template} variables. Leave empty for a trigger-only command — it still fires a workflow trigger, but sends nothing to chat."
                  }
                </p>
              </div>
            )}

            {formState.type === "function" && (
              <div className="grid gap-2">
                <Label htmlFor="cmd-function">Function</Label>
                <Select
                  value={formState.typeValue}
                  onValueChange={(val) => setFormState((s) => ({ ...s, typeValue: val }))}
                >
                  <SelectTrigger id="cmd-function">
                    <SelectValue placeholder="Select a function..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableFunctions.length === 0 ? (
                      <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                        No functions available from installed modules.
                      </div>
                    ) : (
                      availableFunctions.map((fn) => (
                        <SelectItem key={fn.qualifiedName} value={fn.qualifiedName}>
                          {fn.name} <span className="text-muted-foreground">({fn.moduleName})</span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="cmd-cooldown">Cooldown (seconds)</Label>
                <Input
                  id="cmd-cooldown"
                  type="number"
                  min={0}
                  value={formState.cooldown}
                  onChange={(e) => setFormState((s) => ({ ...s, cooldown: Number(e.target.value) }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cmd-priority">Priority (optional)</Label>
                <Input
                  id="cmd-priority"
                  type="number"
                  value={formState.priority}
                  onChange={(e) => setFormState((s) => ({ ...s, priority: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Visibility</span>
              </div>
              <Select
                value={formState.visibility}
                onValueChange={(val) => setFormState((s) => ({ ...s, visibility: val as Visibility }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public — anyone can use this command</SelectItem>
                  <SelectItem value="restricted">Restricted — only granted groups/users</SelectItem>
                </SelectContent>
              </Select>

              {formState.visibility === "restricted" && (
                <div className="grid gap-3 pl-1">
                  <div className="grid gap-2">
                    <Label>Groups</Label>
                    <GroupMultiSelect groups={groups} selected={formState.groupIds} onToggle={toggleGroup} />
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
                    {formState.usernames.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {formState.usernames.map((user) => (
                          <Badge key={user} variant="secondary" className="gap-1 pr-1">
                            {user}
                            <button
                              type="button"
                              onClick={() => removeUsername(user)}
                              className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
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
                    <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        This command is restricted but has no groups or users granted — it will be invocable by no one.
                        Add at least one group or username, or switch it to Public.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="cmd-enabled"
                checked={formState.enabled}
                onCheckedChange={(checked) => setFormState((s) => ({ ...s, enabled: checked }))}
              />
              <Label htmlFor="cmd-enabled">Enabled</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {editing ? "Save Changes" : "Create Command"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function GroupMultiSelect({
  groups,
  selected,
  onToggle,
}: {
  groups: GroupDoc[];
  selected: string[];
  onToggle: (engineGroupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.engineGroupId, g])), [groups]);

  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="justify-between font-normal">
            {selected.length > 0
              ? `${selected.length} group${selected.length === 1 ? "" : "s"} selected`
              : "Select groups..."}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          <ComboBox>
            <CommandInput placeholder="Search groups..." />
            <CommandList>
              <CommandEmpty>No groups yet. Create one in the Groups tab.</CommandEmpty>
              <CommandGroup>
                {groups.map((group) => {
                  const isSelected = selected.includes(group.engineGroupId);
                  return (
                    <CommandItem
                      key={group.engineGroupId}
                      value={group.name}
                      onSelect={() => onToggle(group.engineGroupId)}
                    >
                      <Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                      {group.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </ComboBox>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 pr-1">
              {groupsById.get(id)?.name ?? id}
              <button
                type="button"
                onClick={() => onToggle(id)}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${groupsById.get(id)?.name ?? id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Groups tab
// ---------------------------------------------------------------------------

interface GroupFormState {
  name: string;
  description: string;
}

const defaultGroupForm: GroupFormState = { name: "", description: "" };

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GroupDoc | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GroupDoc | null>(null);
  const [membersTarget, setMembersTarget] = useState<GroupDoc | null>(null);
  const [formState, setFormState] = useState<GroupFormState>(defaultGroupForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const createGroup = useAction(api.chatCommandActions.createGroup);
  const updateGroup = useAction(api.chatCommandActions.updateGroup);
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

  function openCreateDialog() {
    setEditing(null);
    setFormState(defaultGroupForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEditDialog(group: GroupDoc) {
    setEditing(group);
    setFormState({ name: group.name, description: group.description });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    const name = formState.name.trim();
    if (!name) {
      setFormError("Group name is required.");
      return;
    }
    if (!instanceId) {
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateGroup({
          instanceId,
          engineGroupId: editing.engineGroupId,
          name,
          description: formState.description.trim() || undefined,
        });
        toast({ title: "Group updated" });
      } else {
        await createGroup({
          instanceId,
          name,
          description: formState.description.trim() || undefined,
        });
        toast({ title: "Group created" });
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

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

  return (
    <div>
      <div className="flex items-center justify-end mb-6">
        <Button onClick={openCreateDialog} disabled={!instanceId}>
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
          title="No groups yet"
          description="Create a group to grant a set of usernames access to restricted commands."
          action={{ label: "Add Group", onClick: openCreateDialog }}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Used by</TableHead>
                <TableHead className="w-[160px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group._id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[320px]">
                    {group.description ? truncate(group.description) : <span className="italic">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {usageByGroupId.get(group.engineGroupId) ?? 0} command
                      {(usageByGroupId.get(group.engineGroupId) ?? 0) === 1 ? "" : "s"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setMembersTarget(group)}>
                        <Users className="h-3.5 w-3.5 mr-1.5" />
                        Members
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(group)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(group)}
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

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Group" : "New Group"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {formError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                placeholder="moderator"
                value={formState.name}
                onChange={(e) => setFormState((s) => ({ ...s, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="group-description">Description (optional)</Label>
              <Textarea
                id="group-description"
                placeholder="Channel moderators with elevated command access."
                value={formState.description}
                onChange={(e) => setFormState((s) => ({ ...s, description: e.target.value }))}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {editing ? "Save Changes" : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Members management */}
      <Dialog
        open={membersTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMembersTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{membersTarget?.name} members</DialogTitle>
            <DialogDescription>
              Manage which Twitch usernames belong to this group. Membership is by username — there's no separate user
              picker.
            </DialogDescription>
          </DialogHeader>
          {membersTarget && instanceId && <GroupMembersEditor instanceId={instanceId} group={membersTarget} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersTarget(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupMembersEditor({ instanceId, group }: { instanceId: Id<"instances">; group: GroupDoc }) {
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
    <div className="grid gap-3 py-2">
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
        />
        <Button type="button" variant="outline" onClick={handleAdd} disabled={pending}>
          Add
        </Button>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {members === undefined ? (
          <div className="grid gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-2">No members yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {members.map((username) => (
              <Badge key={username} variant="secondary" className="gap-1 pr-1">
                {username}
                <button
                  type="button"
                  onClick={() => handleRemove(username)}
                  className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                  aria-label={`Remove ${username}`}
                  disabled={pending}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
