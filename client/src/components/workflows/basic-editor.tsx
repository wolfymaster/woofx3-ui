import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ArrowRight, ArrowLeft, Check, Loader2, Sparkles, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { 
  triggerPresets, 
  actionPresets, 
  generateWorkflowFromPresets,
  generateMultiThresholdWorkflow,
  type TriggerPreset,
  type ActionPreset,
  type ThresholdAction,
} from '@/lib/workflow-presets';

interface PresetCardProps<T extends TriggerPreset | ActionPreset> {
  preset: T;
  isSelected: boolean;
  onClick: () => void;
}

function PresetCard<T extends TriggerPreset | ActionPreset>({ 
  preset, 
  isSelected, 
  onClick 
}: PresetCardProps<T>) {
  const Icon = preset.icon;
  
  return (
    <Card 
      className={cn(
        "p-4 cursor-pointer transition-all hover-elevate",
        isSelected && "ring-2 ring-primary bg-primary/5"
      )}
      onClick={onClick}
      data-testid={`card-preset-${preset.id}`}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
          isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
        )}>
          <Icon className={cn("h-5 w-5", !isSelected && preset.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-sm">{preset.name}</h3>
            {isSelected && <Check className="h-4 w-4 text-primary" />}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {preset.description}
          </p>
        </div>
      </div>
    </Card>
  );
}

type EditorStep = 'trigger' | 'configure' | 'action';

interface StepIndicatorProps {
  currentStep: EditorStep;
  trigger: TriggerPreset | null;
  hasThresholds: boolean;
  thresholdActions: ThresholdAction[];
  action: ActionPreset | null;
}

function StepIndicator({ currentStep, trigger, hasThresholds, thresholdActions, action }: StepIndicatorProps) {
  const steps = hasThresholds 
    ? [
        { id: 'trigger', label: '1. Trigger', done: !!trigger && currentStep !== 'trigger' },
        { id: 'configure', label: '2. Configure', done: thresholdActions.length > 0 && currentStep !== 'configure' },
      ]
    : [
        { id: 'trigger', label: '1. Trigger', done: !!trigger && currentStep !== 'trigger' },
        { id: 'action', label: '2. Action', done: !!action },
      ];

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center gap-2">
          {index > 0 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm",
            currentStep === step.id ? "bg-primary text-primary-foreground" : 
            step.done ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
          )}>
            <span className="font-medium">{step.label}</span>
            {step.done && <Check className="h-4 w-4" />}
          </div>
        </div>
      ))}
    </div>
  );
}

interface ThresholdConfigRowProps {
  trigger: TriggerPreset;
  thresholdAction: ThresholdAction;
  index: number;
  onUpdate: (index: number, updates: Partial<ThresholdAction>) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}

function ThresholdConfigRow({ trigger, thresholdAction, index, onUpdate, onRemove, canRemove }: ThresholdConfigRowProps) {
  const ActionIcon = thresholdAction.action?.icon;
  
  return (
    <Card className="p-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Select
            value={thresholdAction.threshold.toString()}
            onValueChange={(value) => onUpdate(index, { threshold: parseInt(value) })}
          >
            <SelectTrigger className="w-28" data-testid={`select-threshold-${index}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {trigger.suggestedThresholds?.map(t => (
                <SelectItem key={t} value={t.toString()}>
                  {t} {trigger.thresholdUnit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

        <div className="flex-1">
          <Select
            value={thresholdAction.action?.id || ''}
            onValueChange={(value) => {
              const action = actionPresets.find(a => a.id === value);
              if (action) onUpdate(index, { action });
            }}
          >
            <SelectTrigger className="w-full" data-testid={`select-action-${index}`}>
              <SelectValue placeholder="Select action..." />
            </SelectTrigger>
            <SelectContent>
              {actionPresets.map(action => (
                <SelectItem key={action.id} value={action.id}>
                  <div className="flex items-center gap-2">
                    <action.icon className={cn("h-4 w-4", action.color)} />
                    {action.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {thresholdAction.action && ActionIcon && (
          <div className={cn("h-8 w-8 rounded flex items-center justify-center bg-muted shrink-0")}>
            <ActionIcon className={cn("h-4 w-4", thresholdAction.action.color)} />
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRemove(index)}
          disabled={!canRemove}
          className="shrink-0"
          data-testid={`button-remove-threshold-${index}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

export function BasicWorkflowEditor() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<EditorStep>('trigger');
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerPreset | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionPreset | null>(null);
  const [thresholdActions, setThresholdActions] = useState<ThresholdAction[]>([]);

  const createWorkflow = useMutation({
    mutationFn: async (data: { name: string; description: string; nodes: any[]; edges: any[] }) => {
      const response = await apiRequest('POST', '/api/workflows', {
        ...data,
        accountId: 'account-1',
        isEnabled: true,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      toast({
        title: 'Workflow created!',
        description: 'Your new workflow is ready to use.',
      });
      navigate(`/workflows/${data.id}`);
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to create workflow. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleTriggerSelect = (trigger: TriggerPreset) => {
    setSelectedTrigger(trigger);
    setSelectedAction(null);
    setThresholdActions([]);
    
    if (trigger.hasThresholds && trigger.suggestedThresholds) {
      setThresholdActions([
        { threshold: trigger.suggestedThresholds[0], action: actionPresets[0] }
      ]);
      setStep('configure');
    } else {
      setStep('action');
    }
  };

  const handleActionSelect = (action: ActionPreset) => {
    setSelectedAction(action);
  };

  const handleAddThreshold = () => {
    if (!selectedTrigger?.suggestedThresholds) return;
    
    const usedThresholds = new Set(thresholdActions.map(ta => ta.threshold));
    const nextThreshold = selectedTrigger.suggestedThresholds.find(t => !usedThresholds.has(t));
    
    if (nextThreshold) {
      setThresholdActions([
        ...thresholdActions,
        { threshold: nextThreshold, action: actionPresets[0] }
      ]);
    }
  };

  const handleUpdateThreshold = (index: number, updates: Partial<ThresholdAction>) => {
    setThresholdActions(prev => prev.map((ta, i) => 
      i === index ? { ...ta, ...updates } : ta
    ));
  };

  const handleRemoveThreshold = (index: number) => {
    setThresholdActions(prev => prev.filter((_, i) => i !== index));
  };

  const handleCreate = () => {
    if (!selectedTrigger) return;
    
    let workflow;
    if (selectedTrigger.hasThresholds) {
      const validThresholdActions = thresholdActions.filter(ta => ta.action);
      if (validThresholdActions.length === 0) return;
      workflow = generateMultiThresholdWorkflow(selectedTrigger, validThresholdActions);
    } else {
      if (!selectedAction) return;
      workflow = generateWorkflowFromPresets(selectedTrigger, selectedAction);
    }
    
    createWorkflow.mutate(workflow);
  };

  const handleBack = () => {
    if (step === 'action' || step === 'configure') {
      setStep('trigger');
      setSelectedAction(null);
      setThresholdActions([]);
    }
  };

  const canCreate = selectedTrigger && (
    selectedTrigger.hasThresholds 
      ? thresholdActions.length > 0 && thresholdActions.every(ta => ta.action)
      : !!selectedAction
  );

  const triggerCategories = ['events', 'chat', 'time', 'stream'] as const;
  const actionCategories = ['alerts', 'chat', 'scene', 'audio', 'integration'] as const;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Quick Workflow Builder</h2>
        </div>
        <p className="text-muted-foreground">
          {step === 'trigger' && "Choose what triggers your workflow"}
          {step === 'configure' && "Configure trigger thresholds and actions"}
          {step === 'action' && "Choose what happens when triggered"}
        </p>
      </div>

      <StepIndicator 
        currentStep={step} 
        trigger={selectedTrigger}
        hasThresholds={!!selectedTrigger?.hasThresholds}
        thresholdActions={thresholdActions}
        action={selectedAction} 
      />

      {step === 'trigger' && (
        <div className="space-y-6">
          {triggerCategories.map(category => {
            const categoryTriggers = triggerPresets.filter(t => t.category === category);
            if (categoryTriggers.length === 0) return null;
            
            return (
              <div key={category}>
                <h3 className="text-sm font-medium text-muted-foreground mb-3 capitalize">
                  {category}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categoryTriggers.map(trigger => (
                    <PresetCard
                      key={trigger.id}
                      preset={trigger}
                      isSelected={selectedTrigger?.id === trigger.id}
                      onClick={() => handleTriggerSelect(trigger)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {step === 'configure' && selectedTrigger && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <selectedTrigger.icon className="h-3 w-3" />
                {selectedTrigger.name}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Configure different tiers
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddThreshold}
              disabled={thresholdActions.length >= (selectedTrigger.suggestedThresholds?.length || 0)}
              data-testid="button-add-threshold"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Tier
            </Button>
          </div>

          <div className="space-y-3">
            {thresholdActions.map((ta, index) => (
              <ThresholdConfigRow
                key={index}
                trigger={selectedTrigger}
                thresholdAction={ta}
                index={index}
                onUpdate={handleUpdateThreshold}
                onRemove={handleRemoveThreshold}
                canRemove={thresholdActions.length > 1}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground text-center mt-4">
            Add multiple tiers to trigger different actions based on the amount
          </p>
        </div>
      )}

      {step === 'action' && (
        <div className="space-y-6">
          {selectedTrigger && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 mb-4">
              <Badge variant="secondary" className="gap-1">
                <selectedTrigger.icon className="h-3 w-3" />
                {selectedTrigger.name}
              </Badge>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Select an action...</span>
            </div>
          )}

          {actionCategories.map(category => {
            const categoryActions = actionPresets.filter(a => a.category === category);
            if (categoryActions.length === 0) return null;
            
            return (
              <div key={category}>
                <h3 className="text-sm font-medium text-muted-foreground mb-3 capitalize">
                  {category}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categoryActions.map(action => (
                    <PresetCard
                      key={action.id}
                      preset={action}
                      isSelected={selectedAction?.id === action.id}
                      onClick={() => handleActionSelect(action)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
        <Button 
          variant="ghost" 
          onClick={handleBack}
          disabled={step === 'trigger'}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="flex items-center gap-3">
          {step === 'configure' && thresholdActions.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {thresholdActions.length} tier{thresholdActions.length > 1 ? 's' : ''} configured
            </span>
          )}
          
          {step === 'action' && selectedTrigger && selectedAction && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="gap-1">
                <selectedTrigger.icon className="h-3 w-3" />
                {selectedTrigger.name}
              </Badge>
              <ArrowRight className="h-4 w-4" />
              <Badge variant="outline" className="gap-1">
                <selectedAction.icon className="h-3 w-3" />
                {selectedAction.name}
              </Badge>
            </div>
          )}
          
          <Button 
            onClick={handleCreate}
            disabled={!canCreate || createWorkflow.isPending}
            data-testid="button-create-workflow"
          >
            {createWorkflow.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            Create Workflow
          </Button>
        </div>
      </div>
    </div>
  );
}
