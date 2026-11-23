import { AlertTriangle, X } from "lucide-react";
import { useMemo, useState } from "react";
import { GroupMultiSelect } from "@/components/commands/group-multi-select";
import { FlowWhenCard } from "@/components/flow/flow-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ChatCommandGroup } from "@/engine/types";
import type { CommandEditorState, CommandVisibility } from "@/lib/command-drafts";
import { addCommandInput, removeCommandInput, splitCommandInput, withCommandWord } from "@/lib/command-input";
import { argumentNames } from "@/lib/command-variables";
import { commandWhenOptions, commandWhenTitle } from "@/lib/command-when";
import { groupLabel } from "@/lib/group-display";

type GroupDoc = ChatCommandGroup;

interface CommandWhenCardProps {
  value: CommandEditorState;
  groups: GroupDoc[];
  onChange: (change: (current: CommandEditorState) => CommandEditorState) => void;
  /** Open at first, for a command being created, whose word is the first thing to fill in. */
  defaultExpanded: boolean;
}

/** Not a step id: the flow focuses the toggle by it after a change elsewhere. */
const WHEN_TOGGLE_ID = "__command";

/**
 * What runs a chat command, as the "When" card of its flow: the command a chatter types and
 * the inputs it captures, its cooldown, and who can use it. Collapsed, it reads as a
 * sentence with those facts under it; "Change" opens the settings in place.
 */
export function CommandWhenCard({ value, groups, onChange, defaultExpanded }: CommandWhenCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [userInput, setUserInput] = useState("");
  const [inputDraft, setInputDraft] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const { command: word, argumentPattern } = splitCommandInput(value.command);
  const inputs = argumentNames(argumentPattern);
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.engineGroupId, group])), [groups]);
  const options = commandWhenOptions(value, (id) => {
    const group = groupsById.get(id);
    return group ? groupLabel(group) : undefined;
  });
  const restrictedWithNoAccess =
    value.visibility === "restricted" && value.groupIds.length === 0 && value.usernames.length === 0;

  function addUsername() {
    const name = userInput.trim().toLowerCase().replace(/^@/, "");
    if (!name) {
      return;
    }
    setUserInput("");
    onChange((current) =>
      current.usernames.includes(name) ? current : { ...current, usernames: [...current.usernames, name] }
    );
  }

  function addInput() {
    if (!inputDraft.trim()) {
      return;
    }
    const result = addCommandInput(value.command, inputDraft);
    if (!result.ok) {
      setInputError(result.error);
      return;
    }
    setInputDraft("");
    setInputError(null);
    onChange((current) => ({ ...current, command: result.command }));
  }

  return (
    <FlowWhenCard
      title={<span className="font-mono">{commandWhenTitle(value.command)}</span>}
      options={options}
      expanded={expanded}
      onToggle={() => setExpanded((open) => !open)}
      toggleId={WHEN_TOGGLE_ID}
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-2">
          <Label htmlFor="cmd-name">Command</Label>
          <div className="relative">
            <span className="absolute left-3 top-2 font-mono text-sm text-muted-foreground">!</span>
            <Input
              id="cmd-name"
              placeholder="sr"
              className="pl-6 font-mono"
              value={word}
              onChange={(e) =>
                onChange((current) => ({ ...current, command: withCommandWord(current.command, e.target.value) }))
              }
              data-testid="input-command-name"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="cmd-input-name">Inputs</Label>
          {inputs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {inputs.map((name) => (
                <Badge key={name} variant="secondary" className="gap-1 pr-1 font-mono">
                  {name}
                  <button
                    type="button"
                    onClick={() =>
                      onChange((current) => ({ ...current, command: removeCommandInput(current.command, name) }))
                    }
                    className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                    aria-label={`Remove ${name}`}
                    data-testid={`button-remove-input-${name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              id="cmd-input-name"
              placeholder="song title"
              value={inputDraft}
              onChange={(e) => {
                setInputDraft(e.target.value);
                setInputError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addInput();
                }
              }}
              data-testid="input-command-input-name"
            />
            <Button type="button" variant="outline" onClick={addInput} data-testid="button-add-command-input">
              Add input
            </Button>
          </div>
          {inputError && <p className="text-xs text-destructive">{inputError}</p>}
          <p className="text-xs text-muted-foreground">
            Inputs are words viewers type after the command, like !sr and a song title.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="cmd-cooldown">Cooldown (seconds)</Label>
            <Input
              id="cmd-cooldown"
              type="number"
              min={0}
              value={value.cooldown}
              onChange={(e) => onChange((current) => ({ ...current, cooldown: Number(e.target.value) }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cmd-priority">Priority (optional)</Label>
            <Input
              id="cmd-priority"
              type="number"
              value={value.priority}
              onChange={(e) => onChange((current) => ({ ...current, priority: Number(e.target.value) }))}
            />
            <p className="text-xs text-muted-foreground">Higher runs first when two commands match.</p>
          </div>
        </div>

        <div className="grid gap-3">
          <Label>Who can use it</Label>
          <Select
            value={value.visibility}
            onValueChange={(next) => onChange((current) => ({ ...current, visibility: next as CommandVisibility }))}
          >
            <SelectTrigger data-testid="select-command-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">Anyone in chat</SelectItem>
              <SelectItem value="restricted">Only the groups and people I pick</SelectItem>
            </SelectContent>
          </Select>

          {value.visibility === "restricted" && (
            <div className="grid gap-3 pl-1">
              <div className="grid gap-2">
                <Label>Groups</Label>
                <GroupMultiSelect
                  groups={groups}
                  selected={value.groupIds}
                  onToggle={(engineGroupId) =>
                    onChange((current) => ({
                      ...current,
                      groupIds: current.groupIds.includes(engineGroupId)
                        ? current.groupIds.filter((id) => id !== engineGroupId)
                        : [...current.groupIds, engineGroupId],
                    }))
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cmd-usernames">Specific people</Label>
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
                {value.usernames.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {value.usernames.map((user) => (
                      <Badge key={user} variant="secondary" className="gap-1 pr-1">
                        {user}
                        <button
                          type="button"
                          onClick={() =>
                            onChange((current) => ({
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
                  <span>No one can use this command yet. Add a group or a person, or let anyone in chat use it.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="cmd-enabled"
            checked={value.enabled}
            onCheckedChange={(checked) => onChange((current) => ({ ...current, enabled: checked }))}
          />
          <Label htmlFor="cmd-enabled">Turned on</Label>
        </div>
      </div>
    </FlowWhenCard>
  );
}
