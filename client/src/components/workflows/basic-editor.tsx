import { useMutation } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { cn } from "@/lib/utils";
import {
  type ActionPreset,
  generateMultiTierWorkflow,
  generateWorkflowFromPresets,
  getDefaultConfigValues,
  type TierConfig,
  type TriggerConfigValues,
  type TriggerPreset,
} from "@/lib/workflow-presets";
import { TriggerConfigForm } from "./trigger-config-form";

interface PresetCardProps<T extends TriggerPreset | ActionPreset> {
  preset: T;
  isSelected: boolean;
  onClick: () => void;
}

function PresetCard<T extends TriggerPreset | ActionPreset>({ preset, isSelected, onClick }: PresetCardProps<T>) {
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
        <div
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
            isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
          )}
        >
          <Icon className={cn("h-5 w-5", !isSelected && preset.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-sm">{preset.name}</h3>
            {isSelected && <Check className="h-4 w-4 text-primary" />}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{preset.description}</p>
        </div>
      </div>
    </Card>
  );
}

// Compact action card for variant action selection
function CompactActionCard({
  action,
  isSelected,
  onClick,
}: {
  action: ActionPreset;
  isSelected: boolean;
  onClick: () => void;
}) {
  const ActionIcon = action.icon;
  return (
    <Card
      className={cn(
        "p-3 cursor-pointer transition-all hover-elevate",
        isSelected && "ring-2 ring-primary bg-primary/5"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <ActionIcon className={cn("h-4 w-4", action.color)} />
        <span className="text-xs font-medium truncate">{action.name}</span>
        {isSelected && <Check className="h-3 w-3 text-primary ml-auto shrink-0" />}
      </div>
    </Card>
  );
}

type EditorStep = "trigger" | "trigger-config" | "action" | "action-config";

interface StepIndicatorProps {
  currentStep: EditorStep;
  hasTriggerConfig: boolean;
  hasActionConfig: boolean;
}

function StepIndicator({ currentStep, hasTriggerConfig, hasActionConfig }: StepIndicatorProps) {
  const allSteps: { id: EditorStep; label: string; show: boolean }[] = [
    { id: "trigger", label: "Trigger", show: true },
    { id: "trigger-config", label: "Configure", show: hasTriggerConfig },
    { id: "action", label: "Action", show: true },
    { id: "action-config", label: "Settings", show: hasActionConfig },
  ];

  const visibleSteps = allSteps.filter((s) => s.show);
  const currentIndex = visibleSteps.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {visibleSteps.map((step, index) => {
        const isActive = step.id === currentStep;
        const isCompleted = index < currentIndex;

        return (
          <div key={step.id} className="flex items-center gap-2">
            {index > 0 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : isCompleted
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              )}
            >
              <span className="font-medium">
                {index + 1}. {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Variant config row - only shows config fields, no action picker
interface VariantConfigRowProps {
  tier: TierConfig;
  trigger: TriggerPreset;
  index: number;
  onUpdate: (id: string, updates: Partial<TierConfig>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}

function VariantConfigRow({ tier, trigger, index, onUpdate, onRemove, canRemove }: VariantConfigRowProps) {
  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant="secondary">Variant {index + 1}</Badge>
          {canRemove && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRemove(tier.id)}
              data-testid={`button-remove-variant-${index}`}
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
      </div>
    </Card>
  );
}

// Variant action row - for selecting action for each variant
interface VariantActionRowProps {
  tier: TierConfig;
  trigger: TriggerPreset;
  index: number;
  actionChoices: ActionPreset[];
  onSelectAction: (tierId: string, action: ActionPreset) => void;
}

function VariantActionRow({ tier, trigger, index, actionChoices, onSelectAction }: VariantActionRowProps) {
  const TriggerIcon = trigger.icon;
  const TierActionIcon = tier.action?.icon;
  // Get a label for this variant based on its config values
  const getVariantLabel = () => {
    const amount = tier.values.amount as { type: string; value?: number; min?: number; max?: number } | undefined;
    if (amount) {
      const unit = trigger.config?.tierLabel || "";
      if (amount.type === "range") {
        return `${amount.min}-${amount.max} ${unit}`;
      }
      return `${amount.value} ${unit}`;
    }
    return `Variant ${index + 1}`;
  };

  return (
    <Card className="p-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <TriggerIcon className="h-3 w-3" />
            {getVariantLabel()}
          </Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          {tier.action && TierActionIcon ? (
            <Badge variant="default" className="gap-1">
              <TierActionIcon className="h-3 w-3" />
              {tier.action.name}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">Select an action...</span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {actionChoices.map((action) => (
            <CompactActionCard
              key={action.id}
              action={action}
              isSelected={tier.action?.id === action.id}
              onClick={() => onSelectAction(tier.id, action)}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

// Variant action config row - for configuring action for each variant
interface VariantActionConfigRowProps {
  tier: TierConfig;
  trigger: TriggerPreset;
  index: number;
  onUpdateConfig: (tierId: string, actionConfig: TriggerConfigValues) => void;
}

function VariantActionConfigRow({ tier, trigger, index, onUpdateConfig }: VariantActionConfigRowProps) {
  if (!tier.action?.config?.fields) return null;

  const TriggerIcon = trigger.icon;
  const ActionIcon = tier.action.icon;

  // Get a label for this variant based on its config values
  const getVariantLabel = () => {
    const amount = tier.values.amount as { type: string; value?: number; min?: number; max?: number } | undefined;
    if (amount) {
      const unit = trigger.config?.tierLabel || "";
      if (amount.type === "range") {
        return `${amount.min}-${amount.max} ${unit}`;
      }
      return `${amount.value} ${unit}`;
    }
    return `Variant ${index + 1}`;
  };

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <TriggerIcon className="h-3 w-3" />
            {getVariantLabel()}
          </Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge variant="default" className="gap-1">
            <ActionIcon className="h-3 w-3" />
            {tier.action.name}
          </Badge>
        </div>

        <TriggerConfigForm
          fields={tier.action.config.fields}
          values={tier.actionConfig}
          onChange={(actionConfig) => onUpdateConfig(tier.id, actionConfig)}
        />
      </div>
    </Card>
  );
}

export function BasicWorkflowEditor() {
  const [, _navigate] = useLocation();
  const { toast } = useToast();
  const { instance, instanceLoading, triggerPresets, actionPresets, loading: catalogLoading } = useWorkflowCatalog();

  const triggerCategoryOrder = useMemo(
    () => Array.from(new Set(triggerPresets.map((t) => t.category))).sort(),
    [triggerPresets]
  );
  const actionCategoryOrder = useMemo(
    () => Array.from(new Set(actionPresets.map((a) => a.category))).sort(),
    [actionPresets]
  );

  const [step, setStep] = useState<EditorStep>("trigger");
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerPreset | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionPreset | null>(null);
  const [triggerConfig, setTriggerConfig] = useState<TriggerConfigValues>({});
  const [actionConfig, setActionConfig] = useState<TriggerConfigValues>({});
  const [tiers, setTiers] = useState<TierConfig[]>([]);

  // TODO(part-c): Rewrite to call convex `workflowActions.createFromDefinition`
  // with the canonical WorkflowDefinition derived from the editor's preset
  // state. The legacy POST /api/workflows REST endpoint was removed as part
  // of the JSON-first refactor (Part B). This mutation is temporarily a
  // no-op that surfaces a toast so the UI still compiles.
  const createWorkflow = useMutation({
    mutationFn: async (_data: { name: string; description: string; nodes: unknown[]; edges: unknown[] }) => {
      throw new Error("Create workflow is disabled until Part C of the JSON-first refactor lands");
    },
    onError: () => {
      toast({
        title: "Create temporarily unavailable",
        description: "The workflow editor is being migrated to the JSON-first engine contract.",
        variant: "destructive",
      });
    },
  });

  const hasTriggerConfig = !!selectedTrigger?.config?.fields?.length;
  const hasActionConfig = selectedTrigger?.config?.supportsTiers
    ? tiers.some((t) => t.action?.config?.fields?.length)
    : !!selectedAction?.config?.fields?.length;
  const supportsTiers = !!selectedTrigger?.config?.supportsTiers;

  const handleTriggerSelect = (trigger: TriggerPreset) => {
    setSelectedTrigger(trigger);
    setSelectedAction(null);
    setTriggerConfig(trigger.config?.fields ? getDefaultConfigValues(trigger.config.fields) : {});
    setActionConfig({});

    if (trigger.config?.supportsTiers) {
      const defaultValues = trigger.config.fields ? getDefaultConfigValues(trigger.config.fields) : {};
      setTiers([
        {
          id: "tier-1",
          values: defaultValues,
          action: null,
          actionConfig: {},
        },
      ]);
    } else {
      setTiers([]);
    }

    // Auto-advance: if trigger has config, go to trigger-config, otherwise go to action
    if (trigger.config?.fields?.length) {
      setStep("trigger-config");
    } else {
      setStep("action");
    }
  };

  const handleActionSelect = (action: ActionPreset) => {
    setSelectedAction(action);
    setActionConfig(action.config?.fields ? getDefaultConfigValues(action.config.fields) : {});

    // Auto-advance: if action has config, go to action-config
    if (action.config?.fields?.length) {
      setStep("action-config");
    }
  };

  const handleVariantActionSelect = (tierId: string, action: ActionPreset) => {
    setTiers((prev) =>
      prev.map((t) =>
        t.id === tierId
          ? {
              ...t,
              action,
              actionConfig: action.config?.fields ? getDefaultConfigValues(action.config.fields) : {},
            }
          : t
      )
    );
  };

  const handleVariantActionConfigUpdate = (tierId: string, actionConfig: TriggerConfigValues) => {
    setTiers((prev) => prev.map((t) => (t.id === tierId ? { ...t, actionConfig } : t)));
  };

  const handleAddVariant = () => {
    if (!selectedTrigger?.config?.fields) return;
    const newTier: TierConfig = {
      id: `tier-${Date.now()}`,
      values: getDefaultConfigValues(selectedTrigger.config.fields),
      action: null,
      actionConfig: {},
    };
    setTiers([...tiers, newTier]);
  };

  const handleUpdateVariant = (id: string, updates: Partial<TierConfig>) => {
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const handleRemoveVariant = (id: string) => {
    setTiers((prev) => prev.filter((t) => t.id !== id));
  };

  const handleContinue = () => {
    if (step === "trigger-config") {
      setStep("action");
    } else if (step === "action" && supportsTiers) {
      // For variant mode, check if all variants have actions and any need config
      const allHaveActions = tiers.every((t) => t.action);
      const anyNeedsConfig = tiers.some((t) => t.action?.config?.fields?.length);
      if (allHaveActions && anyNeedsConfig) {
        setStep("action-config");
      }
    }
  };

  const handleCreate = () => {
    if (!selectedTrigger) return;

    let workflow: ReturnType<typeof generateWorkflowFromPresets>;
    if (supportsTiers && tiers.length > 0) {
      const validTiers = tiers.filter((t) => t.action);
      if (validTiers.length === 0) return;
      workflow = generateMultiTierWorkflow(selectedTrigger, validTiers);
    } else {
      if (!selectedAction) return;
      workflow = generateWorkflowFromPresets(selectedTrigger, selectedAction, triggerConfig, actionConfig);
    }

    createWorkflow.mutate(workflow);
  };

  const handleBack = () => {
    if (step === "action-config") {
      setStep("action");
      if (!supportsTiers) {
        setSelectedAction(null);
        setActionConfig({});
      }
    } else if (step === "action") {
      if (hasTriggerConfig) {
        setStep("trigger-config");
      } else {
        setStep("trigger");
        setSelectedTrigger(null);
      }
      // Clear variant actions when going back
      if (supportsTiers) {
        setTiers((prev) => prev.map((t) => ({ ...t, action: null, actionConfig: {} })));
      }
    } else if (step === "trigger-config") {
      setStep("trigger");
      setSelectedTrigger(null);
    }
  };

  // Can create when:
  // - For variant mode: all variants have actions selected
  // - For simple mode: action is selected
  const canCreate =
    selectedTrigger && (supportsTiers ? tiers.length > 0 && tiers.every((t) => t.action) : !!selectedAction);

  // For variant mode: can continue to action-config if all have actions and any needs config
  const canContinueToActionConfig =
    supportsTiers && tiers.every((t) => t.action) && tiers.some((t) => t.action?.config?.fields?.length);

  // All variants have actions but none need config - can create directly
  const variantsReadyNoConfig =
    supportsTiers && tiers.every((t) => t.action) && !tiers.some((t) => t.action?.config?.fields?.length);

  const stepDescriptions: Record<EditorStep, string> = {
    trigger: "Choose what triggers your workflow",
    "trigger-config": supportsTiers
      ? `Configure ${selectedTrigger?.name || "trigger"} variants`
      : `Configure ${selectedTrigger?.name || "trigger"} settings`,
    action: supportsTiers ? "Choose an action for each variant" : "Choose what happens when triggered",
    "action-config": supportsTiers
      ? "Configure action settings for each variant"
      : `Configure ${selectedAction?.name || "action"} settings`,
  };

  if (instanceLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Loading instance…</p>
      </div>
    );
  }

  if (!instance) {
    return (
      <Alert className="max-w-xl mx-auto">
        <AlertTitle>No instance selected</AlertTitle>
        <AlertDescription>
          Select or create an instance in the shell to load workflow triggers and actions from the catalog.
        </AlertDescription>
      </Alert>
    );
  }

  if (catalogLoading && triggerPresets.length === 0 && actionPresets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground max-w-4xl mx-auto">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Loading workflow catalog…</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Quick Workflow Builder</h2>
        </div>
        <p className="text-muted-foreground">{stepDescriptions[step]}</p>
      </div>

      <StepIndicator currentStep={step} hasTriggerConfig={hasTriggerConfig} hasActionConfig={hasActionConfig} />

      {/* Step 1: Trigger Selection */}
      {step === "trigger" && (
        <div className="space-y-6">
          {triggerPresets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">No triggers available</p>
              <p className="text-xs mt-1">Enable triggers in the modules settings</p>
            </div>
          )}
          {triggerCategoryOrder.map((category) => {
            const categoryTriggers = triggerPresets.filter((t) => t.category === category);
            if (categoryTriggers.length === 0) return null;

            return (
              <div key={category}>
                <h3 className="text-sm font-medium text-muted-foreground mb-3 capitalize">{category}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categoryTriggers.map((trigger) => (
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

      {/* Step 2: Trigger Configuration */}
      {step === "trigger-config" &&
        selectedTrigger &&
        (() => {
          const SelectedTriggerIcon = selectedTrigger.icon;
          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1">
                    <SelectedTriggerIcon className="h-3 w-3" />
                    {selectedTrigger.name}
                  </Badge>
                  {supportsTiers && (
                    <span className="text-sm text-muted-foreground">
                      Add variants for different {selectedTrigger.config?.tierLabel || "amounts"}
                    </span>
                  )}
                </div>
                {supportsTiers && (
                  <Button variant="outline" size="sm" onClick={handleAddVariant} data-testid="button-add-variant">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Variant
                  </Button>
                )}
              </div>

              {supportsTiers ? (
                <div className="space-y-4">
                  {tiers.map((tier, index) => (
                    <VariantConfigRow
                      key={tier.id}
                      tier={tier}
                      trigger={selectedTrigger}
                      index={index}
                      onUpdate={handleUpdateVariant}
                      onRemove={handleRemoveVariant}
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
          );
        })()}

      {/* Step 3: Action Selection */}
      {step === "action" && (
        <div className="space-y-6">
          {selectedTrigger &&
            !supportsTiers &&
            (() => {
              const StIcon = selectedTrigger.icon;
              return (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 mb-4">
                  <Badge variant="secondary" className="gap-1">
                    <StIcon className="h-3 w-3" />
                    {selectedTrigger.name}
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Select an action...</span>
                </div>
              );
            })()}

          {/* Variant mode: show action picker for each variant */}
          {supportsTiers ? (
            <div className="space-y-4">
              {tiers.map((tier, index) => (
                <VariantActionRow
                  key={tier.id}
                  tier={tier}
                  trigger={selectedTrigger!}
                  index={index}
                  actionChoices={actionPresets}
                  onSelectAction={handleVariantActionSelect}
                />
              ))}
            </div>
          ) : (
            /* Simple mode: show all actions */
            actionCategoryOrder.map((category) => {
              const categoryActions = actionPresets.filter((a) => a.category === category);
              if (categoryActions.length === 0) return null;

              return (
                <div key={category}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3 capitalize">{category}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {categoryActions.map((action) => (
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
            })
          )}
        </div>
      )}

      {/* Step 4: Action Configuration */}
      {step === "action-config" && (
        <div className="space-y-4">
          {supportsTiers
            ? /* Variant mode: show config for each variant's action */
              tiers.map((tier, index) => (
                <VariantActionConfigRow
                  key={tier.id}
                  tier={tier}
                  trigger={selectedTrigger!}
                  index={index}
                  onUpdateConfig={handleVariantActionConfigUpdate}
                />
              ))
            : /* Simple mode: show single action config */
              selectedAction &&
              (() => {
                const SelActionIcon = selectedAction.icon;
                const SelTriggerIcon = selectedTrigger?.icon;
                return (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                      {selectedTrigger && SelTriggerIcon && (
                        <>
                          <Badge variant="secondary" className="gap-1">
                            <SelTriggerIcon className="h-3 w-3" />
                            {selectedTrigger.name}
                          </Badge>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </>
                      )}
                      <Badge variant="default" className="gap-1">
                        <SelActionIcon className="h-3 w-3" />
                        {selectedAction.name}
                      </Badge>
                    </div>

                    <Card className="p-6">
                      {selectedAction.config?.fields && (
                        <TriggerConfigForm
                          fields={selectedAction.config.fields}
                          values={actionConfig}
                          onChange={setActionConfig}
                        />
                      )}
                    </Card>
                  </>
                );
              })()}
        </div>
      )}

      {/* Footer with Back and Continue/Create buttons */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
        {step !== "trigger" ? (
          <Button variant="outline" size="lg" onClick={handleBack} className="gap-2" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-3">
          {/* Continue button for trigger-config step */}
          {step === "trigger-config" && (
            <Button onClick={handleContinue} data-testid="button-continue">
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}

          {/* Continue button for variant action step (if any actions need config) */}
          {step === "action" && canContinueToActionConfig && (
            <Button onClick={handleContinue} data-testid="button-continue">
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}

          {/* Create button shows on:
              - action step if simple mode action is selected and has no config
              - action step if variant mode and all variants have actions with no config
              - action-config step
          */}
          {((step === "action" && !supportsTiers && selectedAction && !selectedAction.config?.fields?.length) ||
            (step === "action" && variantsReadyNoConfig) ||
            step === "action-config") && (
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
