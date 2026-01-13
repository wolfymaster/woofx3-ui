import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ArrowRight, ArrowLeft, Check, Loader2, Sparkles, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { TriggerConfigForm } from './trigger-config-form';
import { 
  triggerPresets, 
  actionPresets, 
  generateWorkflowFromPresets,
  generateMultiTierWorkflow,
  getDefaultConfigValues,
  type TriggerPreset,
  type ActionPreset,
  type TierConfig,
  type TriggerConfigValues,
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
  hasConfig: boolean;
}

function StepIndicator({ currentStep, trigger, hasConfig }: StepIndicatorProps) {
  const steps = hasConfig 
    ? [
        { id: 'trigger', label: '1. Trigger' },
        { id: 'configure', label: '2. Configure' },
        { id: 'action', label: '3. Action' },
      ]
    : [
        { id: 'trigger', label: '1. Trigger' },
        { id: 'action', label: '2. Action' },
      ];

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center gap-2">
          {index > 0 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm",
            currentStep === step.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}>
            <span className="font-medium">{step.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface TierRowProps {
  tier: TierConfig;
  trigger: TriggerPreset;
  index: number;
  onUpdate: (id: string, updates: Partial<TierConfig>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}

function TierRow({ tier, trigger, index, onUpdate, onRemove, canRemove }: TierRowProps) {
  const [showActionConfig, setShowActionConfig] = useState(false);
  
  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant="secondary">Tier {index + 1}</Badge>
          {canRemove && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRemove(tier.id)}
              data-testid={`button-remove-tier-${index}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {trigger.config?.fields && (
          <TriggerConfigForm
            fields={trigger.config.fields}
            values={tier.values}
            onChange={(values) => onUpdate(tier.id, { values })}
          />
        )}

        <div className="border-t border-border pt-4">
          <div className="flex items-center gap-2 mb-3">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Then do this action:</span>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {actionPresets.slice(0, 6).map(action => {
              const isSelected = tier.action?.id === action.id;
              const ActionIcon = action.icon;
              return (
                <Card
                  key={action.id}
                  className={cn(
                    "p-3 cursor-pointer transition-all hover-elevate",
                    isSelected && "ring-2 ring-primary bg-primary/5"
                  )}
                  onClick={() => {
                    onUpdate(tier.id, { 
                      action, 
                      actionConfig: action.config?.fields 
                        ? getDefaultConfigValues(action.config.fields) 
                        : {} 
                    });
                    setShowActionConfig(true);
                  }}
                  data-testid={`card-tier-action-${index}-${action.id}`}
                >
                  <div className="flex items-center gap-2">
                    <ActionIcon className={cn("h-4 w-4", action.color)} />
                    <span className="text-xs font-medium truncate">{action.name}</span>
                    {isSelected && <Check className="h-3 w-3 text-primary ml-auto shrink-0" />}
                  </div>
                </Card>
              );
            })}
          </div>

          {tier.action?.config?.fields && showActionConfig && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-3">Configure {tier.action.name}:</p>
              <TriggerConfigForm
                fields={tier.action.config.fields}
                values={tier.actionConfig}
                onChange={(actionConfig) => onUpdate(tier.id, { actionConfig })}
              />
            </div>
          )}
        </div>
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
  const [triggerConfig, setTriggerConfig] = useState<TriggerConfigValues>({});
  const [actionConfig, setActionConfig] = useState<TriggerConfigValues>({});
  const [tiers, setTiers] = useState<TierConfig[]>([]);

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

  const hasConfig = !!selectedTrigger?.config?.fields?.length;
  const supportsTiers = !!selectedTrigger?.config?.supportsTiers;

  const handleTriggerSelect = (trigger: TriggerPreset) => {
    setSelectedTrigger(trigger);
    setSelectedAction(null);
    setTriggerConfig(trigger.config?.fields ? getDefaultConfigValues(trigger.config.fields) : {});
    setActionConfig({});
    
    if (trigger.config?.supportsTiers) {
      const defaultValues = trigger.config.fields ? getDefaultConfigValues(trigger.config.fields) : {};
      setTiers([{ 
        id: 'tier-1', 
        values: defaultValues, 
        action: null, 
        actionConfig: {} 
      }]);
      setStep('configure');
    } else if (trigger.config?.fields?.length) {
      setTiers([]);
      setStep('configure');
    } else {
      setTiers([]);
      setStep('action');
    }
  };

  const handleActionSelect = (action: ActionPreset) => {
    setSelectedAction(action);
    setActionConfig(action.config?.fields ? getDefaultConfigValues(action.config.fields) : {});
  };

  const handleAddTier = () => {
    if (!selectedTrigger?.config?.fields) return;
    const newTier: TierConfig = {
      id: `tier-${Date.now()}`,
      values: getDefaultConfigValues(selectedTrigger.config.fields),
      action: null,
      actionConfig: {},
    };
    setTiers([...tiers, newTier]);
  };

  const handleUpdateTier = (id: string, updates: Partial<TierConfig>) => {
    setTiers(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleRemoveTier = (id: string) => {
    setTiers(prev => prev.filter(t => t.id !== id));
  };

  const handleContinueToAction = () => {
    setStep('action');
  };

  const handleCreate = () => {
    if (!selectedTrigger) return;
    
    let workflow;
    if (supportsTiers && tiers.length > 0) {
      const validTiers = tiers.filter(t => t.action);
      if (validTiers.length === 0) return;
      workflow = generateMultiTierWorkflow(selectedTrigger, validTiers);
    } else {
      if (!selectedAction) return;
      workflow = generateWorkflowFromPresets(selectedTrigger, selectedAction, triggerConfig, actionConfig);
    }
    
    createWorkflow.mutate(workflow);
  };

  const handleBack = () => {
    if (step === 'action') {
      if (hasConfig) {
        setStep('configure');
      } else {
        setStep('trigger');
      }
    } else if (step === 'configure') {
      setStep('trigger');
    }
  };

  const canCreate = selectedTrigger && (
    supportsTiers 
      ? tiers.length > 0 && tiers.every(t => t.action)
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
          {step === 'configure' && "Configure your trigger settings"}
          {step === 'action' && "Choose what happens when triggered"}
        </p>
      </div>

      <StepIndicator 
        currentStep={step} 
        trigger={selectedTrigger}
        hasConfig={hasConfig}
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
                {supportsTiers ? 'Configure tiers' : 'Configure settings'}
              </span>
            </div>
            {supportsTiers && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddTier}
                data-testid="button-add-tier"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Tier
              </Button>
            )}
          </div>

          {supportsTiers ? (
            <div className="space-y-4">
              {tiers.map((tier, index) => (
                <TierRow
                  key={tier.id}
                  tier={tier}
                  trigger={selectedTrigger}
                  index={index}
                  onUpdate={handleUpdateTier}
                  onRemove={handleRemoveTier}
                  canRemove={tiers.length > 1}
                />
              ))}
            </div>
          ) : (
            <Card className="p-6">
              {selectedTrigger.config?.fields && (
                <TriggerConfigForm
                  fields={selectedTrigger.config.fields}
                  values={triggerConfig}
                  onChange={setTriggerConfig}
                />
              )}
            </Card>
          )}
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

          {selectedAction?.config?.fields && (
            <Card className="p-6">
              <h4 className="text-sm font-medium mb-4">Configure {selectedAction.name}</h4>
              <TriggerConfigForm
                fields={selectedAction.config.fields}
                values={actionConfig}
                onChange={setActionConfig}
              />
            </Card>
          )}
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
          {step === 'configure' && !supportsTiers && (
            <Button
              variant="outline"
              onClick={handleContinueToAction}
              data-testid="button-continue"
            >
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
          
          {(step === 'action' || (step === 'configure' && supportsTiers)) && (
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
          )}
        </div>
      </div>
    </div>
  );
}
