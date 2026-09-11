import { api } from "@convex/_generated/api";
import { useMutation } from "@tanstack/react-query";
import type { WorkflowDefinition } from "@woofx3/api";
import { useAction } from "convex/react";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { cn } from "@/lib/utils";
import { suggestVariantDisplayName } from "@/lib/variant-display-name";
import {
  type ActionPreset,
  getDefaultConfigValues,
  type TriggerConfigValues,
  type TriggerPreset,
  type TriggerVariant,
} from "@/lib/workflow-presets";
import { buildDefinitionFromPresets, buildDefinitionsForVariants } from "@/lib/workflow-presets-json";
import { PresetCard } from "./preset-card";
import { TriggerConfigForm } from "./trigger-config-form";

type EditorStep = "trigger" | "trigger-config" | "action" | "action-config";

interface StepIndicatorProps {
  currentStep: EditorStep;
  hasTriggerConfig: boolean;
  hasActionConfig: boolean;
}

function StepIndicator({ currentStep, hasTriggerConfig, hasActionConfig }: StepIndicatorProps) {
  const allSteps: { id: EditorStep; label: string; show: boolean }[] = [
    { id: "trigger", label: "Trigger", show: true },
    { id: "trigger-config", label: "Configure trigger", show: hasTriggerConfig },
    { id: "action", label: "Action", show: true },
    { id: "action-config", label: "Configure action", show: hasActionConfig },
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
  tier: TriggerVariant;
  trigger: TriggerPreset;
  allVariants: TriggerVariant[];
  index: number;
  onUpdate: (id: string, updates: Partial<TriggerVariant>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}

function VariantConfigRow({ tier, trigger, allVariants, index, onUpdate, onRemove, canRemove }: VariantConfigRowProps) {
  const otherNames = allVariants.filter((v) => v.id !== tier.id).map((v) => v.displayName);

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor={`variant-name-${tier.id}`} className="text-xs text-muted-foreground">
              Binding name
            </Label>
            <Input
              id={`variant-name-${tier.id}`}
              value={tier.displayName}
              onChange={(e) => {
                onUpdate(tier.id, { displayName: e.target.value, displayNameCustomized: true });
              }}
              data-testid={`input-variant-name-${index}`}
            />
          </div>
          {canRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 mt-6"
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
            onChange={(values) => {
              const updates: Partial<TriggerVariant> = { values };
              if (!tier.displayNameCustomized) {
                updates.displayName = suggestVariantDisplayName(trigger, values, otherNames);
              }
              onUpdate(tier.id, updates);
            }}
          />
        )}
      </div>
    </Card>
  );
}

// Tab strip for stepping through variants one at a time — keeps "which variant" and
// "how many remain" obvious without stacking every variant's picker in one long scroll.
interface VariantTabStripProps {
  variants: TriggerVariant[];
  activeIndex: number;
  onSelect: (index: number) => void;
  isComplete?: (variant: TriggerVariant) => boolean;
}

function VariantTabStrip({ variants, activeIndex, onSelect, isComplete }: VariantTabStripProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {variants.map((v, index) => {
        const active = index === activeIndex;
        const complete = isComplete?.(v) ?? false;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(index)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 border",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : complete
                  ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                  : "bg-muted text-muted-foreground border-transparent hover:text-foreground"
            )}
            data-testid={`tab-variant-${index}`}
          >
            {complete && <Check className="h-3 w-3" />}
            <span className="max-w-[140px] truncate">{v.displayName}</span>
          </button>
        );
      })}
    </div>
  );
}

interface VariantStepNavProps {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

function VariantStepNav({ index, total, onPrev, onNext }: VariantStepNavProps) {
  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="sm" onClick={onPrev} disabled={index === 0} className="gap-1">
        <ArrowLeft className="h-3.5 w-3.5" />
        Previous
      </Button>
      <span className="text-xs text-muted-foreground">
        Variant {index + 1} of {total}
      </span>
      <Button variant="ghost" size="sm" onClick={onNext} disabled={index === total - 1} className="gap-1">
        Next
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// Action picker for the single active variant — same category-grouped PresetCard grid
// used everywhere else, so the layout matches trigger selection and non-variant action selection.
interface VariantActionPickerProps {
  tier: TriggerVariant;
  actionChoices: ActionPreset[];
  onSelectAction: (tierId: string, action: ActionPreset) => void;
}

function VariantActionPicker({ tier, actionChoices, onSelectAction }: VariantActionPickerProps) {
  const actionCategoryOrder = useMemo(
    () => Array.from(new Set(actionChoices.map((a) => a.category))).sort(),
    [actionChoices]
  );

  return (
    <div className="space-y-4">
      {actionCategoryOrder.map((category) => {
        const categoryActions = actionChoices.filter((a) => a.category === category);
        if (categoryActions.length === 0) {
          return null;
        }
        return (
          <div key={category}>
            <h4 className="text-xs font-medium text-muted-foreground mb-2 capitalize">{category}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {categoryActions.map((action) => (
                <PresetCard
                  key={action.id}
                  preset={action}
                  isSelected={tier.action?.id === action.id}
                  onClick={() => onSelectAction(tier.id, action)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Action config form for the single active variant.
interface VariantActionConfigPickerProps {
  tier: TriggerVariant;
  onUpdateConfig: (tierId: string, actionConfig: TriggerConfigValues) => void;
}

function VariantActionConfigPicker({ tier, onUpdateConfig }: VariantActionConfigPickerProps) {
  if (!tier.action?.config?.fields) {
    return null;
  }
  const ActionIcon = tier.action.icon;

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <Badge variant="default" className="gap-1">
          <ActionIcon className="h-3 w-3" />
          {tier.action.name}
        </Badge>

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
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { instance, instanceLoading, triggerPresets, actionPresets, loading: catalogLoading } = useWorkflowCatalog();
  const instanceId = instance?._id;
  const createFromDefinition = useAction(api.workflowActions.createFromDefinition);

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
  const [variants, setVariants] = useState<TriggerVariant[]>([]);
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);

  // Reset to the first variant whenever the wizard moves to a new step, so "action" and
  // "action-config" always open on variant 1 rather than wherever the user last scrolled to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the step transition itself, not a value read in the body
  useEffect(() => {
    setActiveVariantIndex(0);
  }, [step]);

  const createWorkflow = useMutation({
    mutationFn: async (definition: Omit<WorkflowDefinition, "id">) => {
      if (!instanceId) {
        throw new Error("No instance selected");
      }
      return createFromDefinition({
        instanceId,
        definition: escapeDollarKeys(definition) as Omit<WorkflowDefinition, "id">,
      });
    },
    onSuccess: ({ engineWorkflowId }) => {
      toast({ title: "Workflow created" });
      navigate(`/stream/workflows/${engineWorkflowId}`);
    },
    onError: (err) => {
      toast({
        title: "Failed to create workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const hasTriggerConfig = (selectedTrigger?.config?.fields?.length ?? 0) > 0;
  const allowVariants = !!selectedTrigger?.config?.allowVariants;
  const hasActionConfig = allowVariants
    ? variants.some((t) => (t.action?.config?.fields?.length ?? 0) > 0)
    : (selectedAction?.config?.fields?.length ?? 0) > 0;

  const makeInitialVariant = (trigger: TriggerPreset): TriggerVariant => {
    const defaultValues = trigger.config?.fields ? getDefaultConfigValues(trigger.config.fields) : {};
    return {
      id: `variant-${Date.now()}`,
      displayName: suggestVariantDisplayName(trigger, defaultValues, []),
      values: defaultValues,
      action: null,
      actionConfig: {},
    };
  };

  const handleTriggerSelect = (trigger: TriggerPreset) => {
    if (trigger.id === selectedTrigger?.id) {
      // Already selected (e.g. re-clicked after navigating back) — keep whatever the
      // user has already configured for it instead of resetting to defaults.
      return;
    }
    setSelectedTrigger(trigger);
    setSelectedAction(null);
    setTriggerConfig(trigger.config?.fields ? getDefaultConfigValues(trigger.config.fields) : {});
    setActionConfig({});

    if (trigger.config?.allowVariants) {
      setVariants([makeInitialVariant(trigger)]);
    } else {
      setVariants([]);
    }
  };

  const handleContinueFromTrigger = () => {
    if (!selectedTrigger) {
      return;
    }
    if (hasTriggerConfig) {
      setStep("trigger-config");
    } else {
      setStep("action");
    }
  };

  const handleActionSelect = (action: ActionPreset) => {
    if (action.id === selectedAction?.id) {
      return;
    }
    setSelectedAction(action);
    setActionConfig(action.config?.fields ? getDefaultConfigValues(action.config.fields) : {});
  };

  const handleContinueFromAction = () => {
    if (allowVariants) {
      const allHaveActions = variants.every((t) => t.action);
      const anyNeedsConfig = variants.some((t) => (t.action?.config?.fields?.length ?? 0) > 0);
      if (allHaveActions && anyNeedsConfig) {
        setStep("action-config");
      }
      return;
    }
    if ((selectedAction?.config?.fields?.length ?? 0) > 0) {
      setStep("action-config");
    }
  };

  const handleVariantActionSelect = (tierId: string, action: ActionPreset) => {
    setVariants((prev) =>
      prev.map((t) => {
        if (t.id !== tierId || t.action?.id === action.id) {
          return t;
        }
        return {
          ...t,
          action,
          actionConfig: action.config?.fields ? getDefaultConfigValues(action.config.fields) : {},
        };
      })
    );
  };

  const handleVariantActionConfigUpdate = (tierId: string, actionConfig: TriggerConfigValues) => {
    setVariants((prev) => prev.map((t) => (t.id === tierId ? { ...t, actionConfig } : t)));
  };

  const handleAddVariant = () => {
    if (!selectedTrigger?.config?.fields) {
      return;
    }
    const defaultValues = getDefaultConfigValues(selectedTrigger.config.fields);
    const existingNames = variants.map((v) => v.displayName);
    const newTier: TriggerVariant = {
      id: `tier-${Date.now()}`,
      displayName: suggestVariantDisplayName(selectedTrigger, defaultValues, existingNames),
      values: defaultValues,
      action: null,
      actionConfig: {},
    };
    setVariants([...variants, newTier]);
  };

  const handleUpdateVariant = (id: string, updates: Partial<TriggerVariant>) => {
    setVariants((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const handleRemoveVariant = (id: string) => {
    setVariants((prev) => prev.filter((t) => t.id !== id));
  };

  const handleContinue = () => {
    if (step === "trigger-config") {
      setStep("action");
    } else if (step === "action" && allowVariants) {
      // For variant mode, check if all variants have actions and any need config
      const allHaveActions = variants.every((t) => t.action);
      const anyNeedsConfig = variants.some((t) => t.action?.config?.fields?.length);
      if (allHaveActions && anyNeedsConfig) {
        setStep("action-config");
      }
    }
  };

  const previewDefinitions = useMemo<Omit<WorkflowDefinition, "id">[]>(() => {
    if (!selectedTrigger) {
      return [];
    }
    if (allowVariants && variants.length > 0) {
      const valid = variants.filter((t) => t.action);
      if (valid.length === 0) {
        return [];
      }
      return buildDefinitionsForVariants(selectedTrigger, valid, selectedTrigger.canonicalRef);
    }
    if (!selectedAction) {
      return [];
    }
    return [
      buildDefinitionFromPresets(
        selectedTrigger,
        selectedAction,
        triggerConfig,
        actionConfig,
        selectedTrigger.canonicalRef
      ),
    ];
  }, [selectedTrigger, selectedAction, allowVariants, variants, triggerConfig, actionConfig]);

  const createWorkflows = useMutation({
    mutationFn: async (definitions: Omit<WorkflowDefinition, "id">[]) => {
      if (!instanceId) {
        throw new Error("No instance selected");
      }
      const ids: string[] = [];
      for (const definition of definitions) {
        const result = await createFromDefinition({
          instanceId,
          definition: escapeDollarKeys(definition) as Omit<WorkflowDefinition, "id">,
        });
        ids.push(result.engineWorkflowId);
      }
      return ids;
    },
    onSuccess: (ids) => {
      toast({
        title: ids.length === 1 ? "Workflow created" : `${ids.length} workflows created`,
      });
      if (ids.length === 1) {
        navigate(`/stream/workflows/${ids[0]}`);
      } else {
        navigate("/stream/workflows");
      }
    },
    onError: (err) => {
      toast({
        title: "Failed to create workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const handleCreate = () => {
    if (previewDefinitions.length === 0) {
      return;
    }
    if (previewDefinitions.length === 1) {
      createWorkflow.mutate(previewDefinitions[0]);
    } else {
      createWorkflows.mutate(previewDefinitions);
    }
  };

  // Going back never clears a prior selection — the user should see exactly what they'd
  // chosen and can either continue forward again or pick something different.
  const handleBack = () => {
    if (step === "action-config") {
      setStep("action");
    } else if (step === "action") {
      setStep(hasTriggerConfig ? "trigger-config" : "trigger");
    } else if (step === "trigger-config") {
      setStep("trigger");
    }
  };

  // Can create when:
  // - For variant mode: all variants have actions selected
  // - For simple mode: action is selected
  const canCreate =
    selectedTrigger && (allowVariants ? variants.length > 0 && variants.every((t) => t.action) : !!selectedAction);

  const canContinueFromAction = allowVariants
    ? variants.every((t) => t.action) && variants.some((t) => (t.action?.config?.fields?.length ?? 0) > 0)
    : !!selectedAction && (selectedAction.config?.fields?.length ?? 0) > 0;

  // All variants have actions but none need config - can create directly
  const variantsReadyNoConfig =
    allowVariants && variants.every((t) => t.action) && !variants.some((t) => t.action?.config?.fields?.length);

  // Only variants whose chosen action actually has config fields get a step in the config nav.
  const configurableVariants = useMemo(
    () => variants.filter((t) => (t.action?.config?.fields?.length ?? 0) > 0),
    [variants]
  );
  const activeVariant = variants[activeVariantIndex] ?? null;
  const activeConfigVariant = configurableVariants[activeVariantIndex] ?? null;

  const stepDescriptions: Record<EditorStep, string> = {
    trigger: "Choose what triggers your workflow",
    "trigger-config": allowVariants
      ? `Configure ${selectedTrigger?.name || "trigger"} variants`
      : `Configure ${selectedTrigger?.name || "trigger"} settings`,
    action: allowVariants ? "Choose an action for each variant" : "Choose what happens when triggered",
    "action-config": allowVariants
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
      <StepIndicator currentStep={step} hasTriggerConfig={hasTriggerConfig} hasActionConfig={hasActionConfig} />
      <p className="text-center text-sm text-muted-foreground mb-6">{stepDescriptions[step]}</p>

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
                  {allowVariants && (
                    <span className="text-sm text-muted-foreground">Add variants with different trigger settings</span>
                  )}
                </div>
                {allowVariants && (
                  <Button variant="outline" size="sm" onClick={handleAddVariant} data-testid="button-add-variant">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Variant
                  </Button>
                )}
              </div>

              {allowVariants ? (
                <div className="space-y-4">
                  {variants.map((tier, index) => (
                    <VariantConfigRow
                      key={tier.id}
                      tier={tier}
                      trigger={selectedTrigger}
                      allVariants={variants}
                      index={index}
                      onUpdate={handleUpdateVariant}
                      onRemove={handleRemoveVariant}
                      canRemove={variants.length > 1}
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
            !allowVariants &&
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

          {/* Variant mode: choose an action for one variant at a time */}
          {allowVariants ? (
            <div className="space-y-4">
              <VariantTabStrip
                variants={variants}
                activeIndex={activeVariantIndex}
                onSelect={setActiveVariantIndex}
                isComplete={(v) => !!v.action}
              />
              {activeVariant && (
                <>
                  <VariantStepNav
                    index={activeVariantIndex}
                    total={variants.length}
                    onPrev={() => setActiveVariantIndex((i) => Math.max(0, i - 1))}
                    onNext={() => setActiveVariantIndex((i) => Math.min(variants.length - 1, i + 1))}
                  />
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                    <Badge variant="secondary" className="gap-1">
                      {activeVariant.displayName}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    {activeVariant.action ? (
                      <Badge variant="default" className="gap-1">
                        {(() => {
                          const Icon = activeVariant.action.icon;
                          return <Icon className="h-3 w-3" />;
                        })()}
                        {activeVariant.action.name}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">Select an action...</span>
                    )}
                  </div>
                  <VariantActionPicker
                    tier={activeVariant}
                    actionChoices={actionPresets}
                    onSelectAction={handleVariantActionSelect}
                  />
                </>
              )}
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
          {allowVariants ? (
            /* Variant mode: configure one variant's action at a time */
            <>
              <VariantTabStrip
                variants={configurableVariants}
                activeIndex={activeVariantIndex}
                onSelect={setActiveVariantIndex}
              />
              {activeConfigVariant && (
                <>
                  <VariantStepNav
                    index={activeVariantIndex}
                    total={configurableVariants.length}
                    onPrev={() => setActiveVariantIndex((i) => Math.max(0, i - 1))}
                    onNext={() => setActiveVariantIndex((i) => Math.min(configurableVariants.length - 1, i + 1))}
                  />
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                    <Badge variant="secondary" className="gap-1">
                      {activeConfigVariant.displayName}
                    </Badge>
                  </div>
                  <VariantActionConfigPicker
                    tier={activeConfigVariant}
                    onUpdateConfig={handleVariantActionConfigUpdate}
                  />
                </>
              )}
            </>
          ) : (
            /* Simple mode: show single action config */
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
            })()
          )}
        </div>
      )}

      {/* Preview generated JSON on the final step, before the action buttons */}
      {canCreate && previewDefinitions.length > 0 && (
        <details className="mt-6" data-testid="details-preview-json">
          <summary className="text-sm text-muted-foreground cursor-pointer">
            Preview generated JSON ({previewDefinitions.length} workflow
            {previewDefinitions.length === 1 ? "" : "s"})
          </summary>
          <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-auto max-h-64">
            {JSON.stringify(previewDefinitions, null, 2)}
          </pre>
        </details>
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
          {step === "trigger" && selectedTrigger && (
            <Button onClick={handleContinueFromTrigger} data-testid="button-continue">
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}

          {step === "trigger-config" && (
            <Button onClick={handleContinue} data-testid="button-continue">
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}

          {step === "action" && canContinueFromAction && (
            <Button onClick={handleContinueFromAction} data-testid="button-continue">
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}

          {/* Create button shows on:
              - action step if simple mode action is selected and has no config
              - action step if variant mode and all variants have actions with no config
              - action-config step
          */}
          {((step === "action" && !allowVariants && selectedAction && !selectedAction.config?.fields?.length) ||
            (step === "action" && variantsReadyNoConfig) ||
            step === "action-config") && (
            <Button
              onClick={handleCreate}
              disabled={!canCreate || createWorkflow.isPending || createWorkflows.isPending}
              data-testid="button-create-workflow"
            >
              {createWorkflow.isPending || createWorkflows.isPending ? (
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
