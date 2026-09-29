import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  chatCommandParts,
  extractMacroVariables,
  type MacroActionType,
  type MacroButton,
  type MacroHttpMethod,
  type MacroInput,
} from "@/lib/macro-pad";
import { MacroColorPicker } from "./macro-color-picker";
import { MacroIconPicker } from "./macro-icon-picker";

/**
 * Minimal shape the picker needs — only `id` + `name` are read. Sourced from
 * `api.moduleEngine.listWorkflows`, which projects the engine's
 * PaginatedWorkflows into this.
 */
type WorkflowOption = { id: string; name: string };

/** A chat command the "Chat Command" dropdown offers, from `api.chatCommands.list`. */
type CommandOption = { command: string; argumentPattern?: string; enabled: boolean };

interface MacroConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  macro: MacroButton | null;
  workflows: WorkflowOption[];
  commands: CommandOption[];
  /** Ids are assigned by the server, so an edit is identified by `macro`, not by the payload. */
  onSave: (input: MacroInput) => void;
}

export function MacroConfigModal({ open, onOpenChange, macro, workflows, commands, onSave }: MacroConfigModalProps) {
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [color, setColor] = useState<string | undefined>(undefined);
  const [type, setType] = useState<MacroActionType>("send-message");
  const [message, setMessage] = useState("");
  const [command, setCommand] = useState("");
  const [commandText, setCommandText] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [httpUrl, setHttpUrl] = useState("");
  const [httpMethod, setHttpMethod] = useState<MacroHttpMethod>("GET");
  const [httpHeaders, setHttpHeaders] = useState("");
  const [httpBody, setHttpBody] = useState("");

  // `open` deliberately triggers the reset branch even when `macro` (e.g.
  // repeatedly null for "Add Macro") doesn't change identity between opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open is a deliberate re-run trigger for the form reset
  useEffect(() => {
    if (macro) {
      setLabel(macro.label);
      setIcon(macro.icon);
      setColor(macro.color);
      setType(macro.type);
      setMessage(macro.config.message || "");
      const parts = chatCommandParts(macro.config);
      setCommand(parts.command);
      setCommandText(parts.text);
      setWorkflowId(macro.config.workflowId || "");
      setHttpUrl(macro.config.url || "");
      setHttpMethod(macro.config.method || "GET");
      setHttpHeaders(JSON.stringify(macro.config.headers || {}, null, 2));
      setHttpBody(macro.config.body || "");
    } else {
      setLabel("");
      setIcon(undefined);
      setColor(undefined);
      setType("send-message");
      setMessage("");
      setCommand("");
      setCommandText("");
      setWorkflowId("");
      setHttpUrl("");
      setHttpMethod("GET");
      setHttpHeaders("");
      setHttpBody("");
    }
  }, [macro, open]);

  // Headers are typed as free text, so a half-written JSON object is a normal
  // intermediate state — treat unparseable as "no headers yet" rather than
  // letting it throw on every keystroke.
  const parsedHeaders = useMemo((): Record<string, string> => {
    if (!httpHeaders.trim()) {
      return {};
    }
    try {
      const parsed = JSON.parse(httpHeaders);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }, [httpHeaders]);

  const variables = useMemo(
    () =>
      extractMacroVariables({
        ...(type === "send-message" && { message }),
        ...(type === "chat-command" && { commandText }),
        ...(type === "http-request" && { url: httpUrl, body: httpBody, headers: parsedHeaders }),
      }),
    [type, message, commandText, httpUrl, httpBody, parsedHeaders]
  );

  const selectedCommand = commands.find((option) => option.command === command);
  // A button can outlive the command it runs; keep that name selectable so
  // opening the editor does not silently blank it.
  const commandOptions =
    command && !selectedCommand ? [{ command, enabled: false, missing: true }, ...commands] : commands;

  const isComplete =
    label.trim().length > 0 &&
    (type !== "send-message" || message.trim().length > 0) &&
    (type !== "chat-command" || command.length > 0) &&
    (type !== "trigger-workflow" || workflowId.length > 0);

  const handleSave = () => {
    if (!isComplete) {
      return;
    }

    const newMacro: MacroInput = {
      label: label.trim(),
      icon,
      color,
      type,
      config: {
        ...(type === "send-message" && { message }),
        ...(type === "chat-command" && { command, commandText }),
        ...(type === "trigger-workflow" && { workflowId }),
        ...(type === "http-request" && {
          url: httpUrl,
          method: httpMethod,
          headers: parsedHeaders,
          body: httpBody,
        }),
      },
    };

    onSave(newMacro);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{macro ? "Edit Macro" : "Add Macro"}</DialogTitle>
          <DialogDescription>Configure a macro button that can execute actions when pressed.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="macro-label">Label</Label>
              <Input
                id="macro-label"
                placeholder="e.g., Send Hello"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                data-testid="input-macro-label"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="macro-icon">Icon</Label>
              <MacroIconPicker id="macro-icon" value={icon} onChange={setIcon} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <MacroColorPicker value={color} onChange={setColor} />
          </div>

          <Tabs value={type} onValueChange={(v) => setType(v as MacroActionType)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="send-message">Send Message</TabsTrigger>
              <TabsTrigger value="chat-command">Chat Command</TabsTrigger>
              <TabsTrigger value="trigger-workflow">Workflow</TabsTrigger>
              <TabsTrigger value="http-request">HTTP Request</TabsTrigger>
            </TabsList>

            <TabsContent value="send-message" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="chat-message">Message</Label>
                <Textarea
                  id="chat-message"
                  placeholder="e.g., Welcome in, {{name}}!"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={500}
                  data-testid="input-macro-message"
                />
                <p className="text-xs text-muted-foreground">Posted to chat as the broadcaster.</p>
              </div>
            </TabsContent>

            <TabsContent value="chat-command" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="chat-command">Command</Label>
                <Select value={command} onValueChange={setCommand}>
                  <SelectTrigger id="chat-command" data-testid="select-macro-command">
                    <SelectValue placeholder={commands.length > 0 ? "Select a command" : "No chat commands yet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {commandOptions.map((option) => (
                      <SelectItem key={option.command} value={option.command}>
                        !{option.command}
                        {"missing" in option ? " (not found)" : !option.enabled && " (disabled)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Runs the command as the broadcaster.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="chat-command-text">Arguments</Label>
                <Input
                  id="chat-command-text"
                  placeholder={selectedCommand?.argumentPattern || "e.g., {{channel}}"}
                  value={commandText}
                  onChange={(e) => setCommandText(e.target.value)}
                  data-testid="input-macro-command-text"
                />
                <p className="text-xs text-muted-foreground">
                  {selectedCommand?.argumentPattern ? (
                    <>
                      Typed after the command, as in chat. This command expects{" "}
                      <code className="font-mono text-foreground">{selectedCommand.argumentPattern}</code>.
                    </>
                  ) : (
                    "Optional. Typed after the command, as in chat."
                  )}
                </p>
              </div>
            </TabsContent>

            <TabsContent value="trigger-workflow" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="workflow-select">Workflow</Label>
                <Select value={workflowId} onValueChange={setWorkflowId}>
                  <SelectTrigger id="workflow-select">
                    <SelectValue placeholder="Select a workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    {workflows.map((workflow) => (
                      <SelectItem key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">The workflow to trigger when this macro is executed.</p>
              </div>
            </TabsContent>

            <TabsContent value="http-request" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="http-url">URL</Label>
                <Input
                  id="http-url"
                  placeholder="https://api.example.com/{{target}}"
                  value={httpUrl}
                  onChange={(e) => setHttpUrl(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="http-method">Method</Label>
                <Select value={httpMethod} onValueChange={(v) => setHttpMethod(v as MacroHttpMethod)}>
                  <SelectTrigger id="http-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                    <SelectItem value="DELETE">DELETE</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="http-headers">Headers (JSON)</Label>
                <Textarea
                  id="http-headers"
                  placeholder='{"Authorization": "Bearer token"}'
                  value={httpHeaders}
                  onChange={(e) => setHttpHeaders(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="http-body">Body (JSON)</Label>
                <Textarea
                  id="http-body"
                  placeholder='{"key": "value"}'
                  value={httpBody}
                  onChange={(e) => setHttpBody(e.target.value)}
                  rows={4}
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="rounded-md border border-border p-3 space-y-1.5" data-testid="macro-variables-hint">
            <p className="text-xs font-medium">Variables</p>
            {variables.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Pressing this button will ask for{" "}
                {variables.map((name, index) => (
                  <span key={name}>
                    {index > 0 && ", "}
                    <code className="font-mono text-foreground">{name}</code>
                  </span>
                ))}
                .
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Write <code className="font-mono">{"{{name}}"}</code> anywhere above to be asked for its value each time
                the button is pressed.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isComplete} data-testid="button-save-macro">
            {macro ? "Save Changes" : "Add Macro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
