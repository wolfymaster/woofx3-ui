import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
  Search,
  Clock,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useInstance } from "@/hooks/use-instance";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type CommandType = "static" | "dynamic" | "function";

interface CommandFormState {
  command: string;
  type: CommandType;
  response: string;
  template: string;
  functionId: string;
  cooldown: number;
  enabled: boolean;
}

const defaultFormState: CommandFormState = {
  command: "",
  type: "static",
  response: "",
  template: "",
  functionId: "",
  cooldown: 5,
  enabled: true,
};

function typeBadgeVariant(type: CommandType): "default" | "secondary" | "outline" {
  switch (type) {
    case "static":
      return "default";
    case "dynamic":
      return "secondary";
    case "function":
      return "outline";
  }
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
            <TableHead>Cooldown</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-48" /></TableCell>
              <TableCell><Skeleton className="h-4 w-12" /></TableCell>
              <TableCell><Skeleton className="h-4 w-10" /></TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function getResponsePreview(cmd: { type: string; response?: string; template?: string; functionId?: string }): string {
  switch (cmd.type) {
    case "static":
      return cmd.response || "\u2014";
    case "dynamic":
      return cmd.template || "\u2014";
    case "function":
      return cmd.functionId ? `fn:${cmd.functionId}` : "\u2014";
    default:
      return "\u2014";
  }
}

function truncate(text: string, max = 60): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

export default function Commands() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"chatCommands"> | null>(null);
  const [deleteId, setDeleteId] = useState<Id<"chatCommands"> | null>(null);
  const [formState, setFormState] = useState<CommandFormState>(defaultFormState);
  const [formError, setFormError] = useState<string | null>(null);

  const commandsRaw = useQuery(
    api.chatCommands.list,
    instance ? { instanceId: instance._id } : "skip",
  );

  const createCommand = useMutation(api.chatCommands.create);
  const updateCommand = useMutation(api.chatCommands.update);
  const removeCommand = useMutation(api.chatCommands.remove);
  const toggleEnabled = useMutation(api.chatCommands.toggleEnabled);

  const commands = commandsRaw ?? [];
  const isLoading = instanceLoading || commandsRaw === undefined;

  const filteredCommands = searchQuery.trim()
    ? commands.filter((c) => c.command.toLowerCase().includes(searchQuery.toLowerCase()))
    : commands;

  function openCreateDialog() {
    setEditingId(null);
    setFormState(defaultFormState);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEditDialog(cmd: (typeof commands)[number]) {
    setEditingId(cmd._id);
    setFormState({
      command: cmd.command,
      type: cmd.type,
      response: cmd.response ?? "",
      template: cmd.template ?? "",
      functionId: cmd.functionId ?? "",
      cooldown: cmd.cooldown,
      enabled: cmd.enabled,
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    setFormError(null);

    if (!formState.command.trim()) {
      setFormError("Command name is required.");
      return;
    }

    if (formState.type === "static" && !formState.response.trim()) {
      setFormError("Response text is required for static commands.");
      return;
    }

    if (formState.type === "dynamic" && !formState.template.trim()) {
      setFormError("Template is required for dynamic commands.");
      return;
    }

    if (formState.type === "function" && !formState.functionId.trim()) {
      setFormError("Function ID is required for function commands.");
      return;
    }

    try {
      if (editingId) {
        await updateCommand({
          commandId: editingId,
          command: formState.command,
          type: formState.type,
          response: formState.type === "static" ? formState.response : undefined,
          template: formState.type === "dynamic" ? formState.template : undefined,
          functionId: formState.type === "function" ? formState.functionId : undefined,
          cooldown: formState.cooldown,
          enabled: formState.enabled,
        });
      } else if (instance) {
        await createCommand({
          instanceId: instance._id,
          command: formState.command,
          type: formState.type,
          response: formState.type === "static" ? formState.response : undefined,
          template: formState.type === "dynamic" ? formState.template : undefined,
          functionId: formState.type === "function" ? formState.functionId : undefined,
          cooldown: formState.cooldown,
          enabled: formState.enabled,
        });
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setFormError(message);
    }
  }

  async function handleDelete() {
    if (!deleteId) {
      return;
    }
    try {
      await removeCommand({ commandId: deleteId });
    } catch {
      // Convex will show its own error toast
    }
    setDeleteId(null);
  }

  async function handleToggle(commandId: Id<"chatCommands">) {
    try {
      await toggleEnabled({ commandId });
    } catch {
      // Convex will show its own error toast
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Chat Commands"
        description="Manage chat commands for your stream."
      />

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
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Command
        </Button>
      </div>

      {isLoading ? (
        <CommandTableSkeleton />
      ) : filteredCommands.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No commands found"
          description={
            searchQuery
              ? "Try adjusting your search."
              : "Create your first chat command to get started."
          }
          action={
            !searchQuery
              ? { label: "Add Command", onClick: openCreateDialog }
              : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Command</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Response</TableHead>
                <TableHead>Cooldown</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCommands.map((cmd) => (
                <TableRow key={cmd._id}>
                  <TableCell className="font-mono font-medium">{cmd.command}</TableCell>
                  <TableCell>
                    <Badge variant={typeBadgeVariant(cmd.type)} className="capitalize">
                      {cmd.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px] text-muted-foreground">
                    <span title={getResponsePreview(cmd)}>
                      {truncate(getResponsePreview(cmd))}
                    </span>
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
                      onClick={() => handleToggle(cmd._id)}
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
                        onClick={() => openEditDialog(cmd)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(cmd._id)}
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
            <DialogTitle>{editingId ? "Edit Command" : "New Command"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {formError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="cmd-name">Command</Label>
              <Input
                id="cmd-name"
                placeholder="!hello"
                value={formState.command}
                onChange={(e) => setFormState((s) => ({ ...s, command: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cmd-type">Type</Label>
              <Select
                value={formState.type}
                onValueChange={(val) => setFormState((s) => ({ ...s, type: val as CommandType }))}
              >
                <SelectTrigger id="cmd-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="static">Static</SelectItem>
                  <SelectItem value="dynamic">Dynamic</SelectItem>
                  <SelectItem value="function">Function</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formState.type === "static" && (
              <div className="grid gap-2">
                <Label htmlFor="cmd-response">Response</Label>
                <Textarea
                  id="cmd-response"
                  placeholder="Hello, welcome to the stream!"
                  value={formState.response}
                  onChange={(e) => setFormState((s) => ({ ...s, response: e.target.value }))}
                  rows={3}
                />
              </div>
            )}

            {formState.type === "dynamic" && (
              <div className="grid gap-2">
                <Label htmlFor="cmd-template">Template</Label>
                <Textarea
                  id="cmd-template"
                  placeholder="Hello {{username}}, welcome!"
                  value={formState.template}
                  onChange={(e) => setFormState((s) => ({ ...s, template: e.target.value }))}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  {"Use {{username}}, {{args}}, etc. for dynamic values."}
                </p>
              </div>
            )}

            {formState.type === "function" && (
              <div className="grid gap-2">
                <Label htmlFor="cmd-function">Function ID</Label>
                <Input
                  id="cmd-function"
                  placeholder="module.functionName"
                  value={formState.functionId}
                  onChange={(e) => setFormState((s) => ({ ...s, functionId: e.target.value }))}
                />
              </div>
            )}

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
            <Button onClick={handleSave}>
              {editingId ? "Save Changes" : "Create Command"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) { setDeleteId(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Command</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this command? This action cannot be undone.
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
