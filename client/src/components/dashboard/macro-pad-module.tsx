import { useState, useCallback, useEffect } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  Pencil,
  MessageSquare,
  Workflow,
  Globe,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { transport } from '@/lib/transport';
import type { Workflow as TransportWorkflow } from '@/lib/transport';
import { useInstance } from '@/hooks/use-instance';
import { MacroConfigModal } from './macro-config-modal';

export interface MacroButton {
  id: string;
  label: string;
  icon?: string;
  type: 'chat-command' | 'trigger-workflow' | 'http-request';
  config: {
    // For chat-command
    command?: string;
    // For trigger-workflow
    workflowId?: string;
    // For http-request
    url?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
  };
}

interface MacroPadModuleProps {
  config?: Record<string, unknown>;
  onConfigChange?: (config: Record<string, unknown>) => void;
}

export function MacroPadModule({ config, onConfigChange }: MacroPadModuleProps) {
  const { instance } = useInstance();
  const [macros, setMacros] = useState<MacroButton[]>(
    (config?.macros as MacroButton[]) || []
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [editingMacro, setEditingMacro] = useState<MacroButton | null>(null);
  const [isExecuting, setIsExecuting] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<TransportWorkflow[]>([]);

  // Load workflows via transport
  useEffect(() => {
    if (!instance) return;
    transport.getWorkflows(instance._id).then(setWorkflows).catch(console.error);
  }, [instance?._id]);

  // Sync macros from config when it changes
  useEffect(() => {
    if (config?.macros) {
      setMacros(config.macros as MacroButton[]);
    }
  }, [config?.macros]);

  const handleAddMacro = useCallback(() => {
    setEditingMacro(null);
    setConfigModalOpen(true);
  }, []);

  const handleEditMacro = useCallback((macro: MacroButton) => {
    setEditingMacro(macro);
    setConfigModalOpen(true);
  }, []);

  const handleDeleteMacro = useCallback((id: string) => {
    const newMacros = macros.filter(m => m.id !== id);
    setMacros(newMacros);
    onConfigChange?.({ macros: newMacros });
  }, [macros, onConfigChange]);

  const handleSaveMacro = useCallback((macro: MacroButton) => {
    let newMacros: MacroButton[];
    if (editingMacro) {
      // Update existing macro
      newMacros = macros.map(m => m.id === editingMacro.id ? macro : m);
    } else {
      // Add new macro
      newMacros = [...macros, macro];
    }
    setMacros(newMacros);
    onConfigChange?.({ macros: newMacros });
    setConfigModalOpen(false);
    setEditingMacro(null);
  }, [editingMacro, macros, onConfigChange]);

  const handleExecuteMacro = useCallback(async (macro: MacroButton) => {
    if (isEditMode) return;
    
    setIsExecuting(macro.id);
    try {
      switch (macro.type) {
        case 'chat-command':
          // Execute chat command
          if (macro.config.command) {
            // TODO: Implement chat command execution via API
            console.log('Executing chat command:', macro.config.command);
          }
          break;
        case 'trigger-workflow':
          // Trigger workflow
          if (macro.config.workflowId) {
            // TODO: Implement workflow trigger via API
            console.log('Triggering workflow:', macro.config.workflowId);
          }
          break;
        case 'http-request':
          // Make HTTP request
          if (macro.config.url) {
            const response = await fetch(macro.config.url, {
              method: macro.config.method || 'GET',
              headers: macro.config.headers || {},
              body: macro.config.body ? JSON.stringify(JSON.parse(macro.config.body)) : undefined,
            });
            console.log('HTTP request result:', response.status);
          }
          break;
      }
    } catch (error) {
      console.error('Failed to execute macro:', error);
    } finally {
      setIsExecuting(null);
    }
  }, [isEditMode]);

  const getIcon = (iconName?: string) => {
    const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
      'message': MessageSquare,
      'workflow': Workflow,
      'globe': Globe,
    };
    return iconMap[iconName || ''] || MessageSquare;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">Macro Pad</span>
        <div className="flex items-center gap-1">
          {macros.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsEditMode(!isEditMode)}
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleAddMacro}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 p-3 overflow-auto">
        {macros.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="text-center mb-4">
              <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center mb-3 mx-auto">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground mb-2">No macros yet</p>
              <p className="text-xs text-muted-foreground mb-4">
                Add your first macro to get started
              </p>
            </div>
            <Button onClick={handleAddMacro} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Macro
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {macros.map((macro) => {
              const Icon = getIcon(macro.icon);
              const isExecutingThis = isExecuting === macro.id;

              return (
                <Card
                  key={macro.id}
                  className={cn(
                    'aspect-square flex flex-col items-center justify-center p-2 relative transition-all',
                    !isEditMode && 'cursor-pointer hover:bg-muted/50',
                    isExecutingThis && 'opacity-50'
                  )}
                  onClick={() => !isEditMode && handleExecuteMacro(macro)}
                >
                  {isEditMode && (
                    <div className="absolute top-1 right-1 flex gap-1 z-10">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditMacro(macro);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMacro(macro.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-col items-center justify-center gap-1.5 flex-1">
                    {isExecutingThis ? (
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    ) : (
                      <Icon className="h-6 w-6 text-muted-foreground" />
                    )}
                    <span className="text-xs font-medium text-center line-clamp-2">
                      {macro.label}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <MacroConfigModal
        open={configModalOpen}
        onOpenChange={setConfigModalOpen}
        macro={editingMacro}
        workflows={workflows}
        onSave={handleSaveMacro}
      />
    </div>
  );
}
