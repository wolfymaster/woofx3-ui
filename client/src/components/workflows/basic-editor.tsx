import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ArrowRight, ArrowLeft, Check, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { 
  triggerPresets, 
  actionPresets, 
  generateWorkflowFromPresets,
  type TriggerPreset,
  type ActionPreset,
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

interface StepIndicatorProps {
  currentStep: number;
  trigger: TriggerPreset | null;
  action: ActionPreset | null;
}

function StepIndicator({ currentStep, trigger, action }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      <div className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm",
        currentStep === 1 ? "bg-primary text-primary-foreground" : 
        trigger ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
      )}>
        <span className="font-medium">1. Trigger</span>
        {trigger && currentStep > 1 && <Check className="h-4 w-4" />}
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
      <div className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm",
        currentStep === 2 ? "bg-primary text-primary-foreground" : 
        action ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
      )}>
        <span className="font-medium">2. Action</span>
        {action && <Check className="h-4 w-4" />}
      </div>
    </div>
  );
}

export function BasicWorkflowEditor() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerPreset | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionPreset | null>(null);

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
    setStep(2);
  };

  const handleActionSelect = (action: ActionPreset) => {
    setSelectedAction(action);
  };

  const handleCreate = () => {
    if (!selectedTrigger || !selectedAction) return;
    
    const workflow = generateWorkflowFromPresets(selectedTrigger, selectedAction);
    createWorkflow.mutate(workflow);
  };

  const handleBack = () => {
    if (step === 2) {
      setStep(1);
    }
  };

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
          {step === 1 
            ? "Choose what triggers your workflow" 
            : "Choose what happens when triggered"}
        </p>
      </div>

      <StepIndicator 
        currentStep={step} 
        trigger={selectedTrigger} 
        action={selectedAction} 
      />

      {step === 1 && (
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

      {step === 2 && (
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
          disabled={step === 1}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="flex items-center gap-3">
          {selectedTrigger && selectedAction && (
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
            disabled={!selectedTrigger || !selectedAction || createWorkflow.isPending}
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
