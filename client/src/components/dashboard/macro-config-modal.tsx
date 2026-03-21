import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Workflow as WorkflowIcon,
  Globe,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MacroButton } from './macro-pad-module';
import type { Workflow } from '@/lib/transport';

interface MacroConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  macro: MacroButton | null;
  workflows: Workflow[];
  onSave: (macro: MacroButton) => void;
}

export function MacroConfigModal({
  open,
  onOpenChange,
  macro,
  workflows,
  onSave,
}: MacroConfigModalProps) {
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState<string>('');
  const [type, setType] = useState<'chat-command' | 'trigger-workflow' | 'http-request'>('chat-command');
  const [command, setCommand] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [httpUrl, setHttpUrl] = useState('');
  const [httpMethod, setHttpMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('GET');
  const [httpHeaders, setHttpHeaders] = useState('');
  const [httpBody, setHttpBody] = useState('');

  useEffect(() => {
    if (macro) {
      setLabel(macro.label);
      setIcon(macro.icon || '');
      setType(macro.type);
      setCommand(macro.config.command || '');
      setWorkflowId(macro.config.workflowId || '');
      setHttpUrl(macro.config.url || '');
      setHttpMethod(macro.config.method || 'GET');
      setHttpHeaders(JSON.stringify(macro.config.headers || {}, null, 2));
      setHttpBody(macro.config.body || '');
    } else {
      // Reset to defaults
      setLabel('');
      setIcon('');
      setType('chat-command');
      setCommand('');
      setWorkflowId('');
      setHttpUrl('');
      setHttpMethod('GET');
      setHttpHeaders('');
      setHttpBody('');
    }
  }, [macro, open]);

  const handleSave = () => {
    if (!label.trim()) {
      return;
    }

    const newMacro: MacroButton = {
      id: macro?.id || `macro-${Date.now()}`,
      label: label.trim(),
      icon: icon || undefined,
      type,
      config: {
        ...(type === 'chat-command' && { command }),
        ...(type === 'trigger-workflow' && { workflowId }),
        ...(type === 'http-request' && {
          url: httpUrl,
          method: httpMethod,
          headers: httpHeaders ? JSON.parse(httpHeaders) : {},
          body: httpBody,
        }),
      },
    };

    onSave(newMacro);
  };

  const iconOptions = [
    { value: 'message', label: 'Message', icon: MessageSquare },
    { value: 'workflow', label: 'Workflow', icon: WorkflowIcon },
    { value: 'globe', label: 'Globe', icon: Globe },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{macro ? 'Edit Macro' : 'Add Macro'}</DialogTitle>
          <DialogDescription>
            Configure a macro button that can execute actions when pressed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="macro-label">Label</Label>
            <Input
              id="macro-label"
              placeholder="e.g., Send Hello"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="macro-icon">Icon (Optional)</Label>
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger id="macro-icon">
                <SelectValue placeholder="Select an icon" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {iconOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {option.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="macro-type">Action Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger id="macro-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat-command">Send Chat Command</SelectItem>
                <SelectItem value="trigger-workflow">Trigger Workflow</SelectItem>
                <SelectItem value="http-request">HTTP Request</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs value={type} onValueChange={(v) => setType(v as typeof type)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="chat-command">Chat Command</TabsTrigger>
              <TabsTrigger value="trigger-workflow">Workflow</TabsTrigger>
              <TabsTrigger value="http-request">HTTP Request</TabsTrigger>
            </TabsList>

            <TabsContent value="chat-command" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="chat-command">Command</Label>
                <Input
                  id="chat-command"
                  placeholder="e.g., !hello"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The chat command to send when this macro is executed.
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
                <p className="text-xs text-muted-foreground">
                  The workflow to trigger when this macro is executed.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="http-request" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="http-url">URL</Label>
                <Input
                  id="http-url"
                  placeholder="https://api.example.com/endpoint"
                  value={httpUrl}
                  onChange={(e) => setHttpUrl(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="http-method">Method</Label>
                <Select value={httpMethod} onValueChange={(v) => setHttpMethod(v as typeof httpMethod)}>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!label.trim()}>
            {macro ? 'Save Changes' : 'Add Macro'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
