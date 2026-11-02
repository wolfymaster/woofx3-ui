import { ChevronRight, ExternalLink } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { NotRunningBadge } from "@/components/workflows/not-running-badge";
import { useSetWorkflowEnabledRequest } from "@/engine/hooks/use-workflows";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { useNotRunningWorkflows } from "@/hooks/use-workflow-health";
import {
  type EventTrigger,
  moduleStepsName,
  type TriggerGroup,
  type TriggerParts,
  triggerParts,
  triggerSummary,
} from "@/lib/alert-triggers";
import type { SentencePart } from "@/lib/condition-sentence";
import { stepSummary } from "@/lib/step-summary";
import { cn } from "@/lib/utils";
import { resolveCatalogAction } from "@/lib/workflow-node-label";
import { definitionToTree } from "@/lib/workflow-tree";

/** The titles of a workflow's top-level steps, as a closed card lists them. */
function useStepTitles(trigger: EventTrigger | undefined): string[] {
  const { catalogActions } = useWorkflowCatalog();
  return useMemo(() => {
    const read = trigger ? definitionToTree(trigger.definition) : undefined;
    if (!read?.editable) {
      return [];
    }
    return read.tree.steps.map(
      (step) =>
        stepSummary(step, { action: step.type === "action" ? resolveCatalogAction(step, catalogActions) : undefined })
          .title
    );
  }, [trigger, catalogActions]);
}

/** Switches workflows on or off, saying which couldn't be. */
function useSwitchWorkflows() {
  const { toast } = useToast();
  const setEnabled = useSetWorkflowEnabledRequest();
  const [isSwitching, setIsSwitching] = useState(false);
  async function switchWorkflows(triggers: readonly EventTrigger[], isEnabled: boolean) {
    setIsSwitching(true);
    const results = await Promise.allSettled(
      triggers.map((trigger) => setEnabled(trigger.row.engineWorkflowId, isEnabled))
    );
    setIsSwitching(false);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      toast({
        title: isEnabled ? "Couldn't switch everything on" : "Couldn't pause everything",
        description: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
        variant: "destructive",
      });
    }
  }
  return { switchWorkflows, isSwitching };
}

interface TriggerGroupCardProps {
  group: TriggerGroup;
  sentence: ReactNode;
  /** The sentence as a plain string, naming the card to a screen reader. */
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  /** The step editor for the streamer's steps, given what else runs on the trigger. */
  editor: (steps: EventTrigger, alsoRuns: ReactNode) => ReactNode;
  /** Starts the streamer's own steps on this trigger, which has none running. */
  onAddSteps: () => void;
}

/**
 * One trigger: its sentence, opening onto the streamer's steps as one list and what else
 * runs after them. Everything the card holds starts on the same event under the same
 * conditions, so its switch pauses or resumes all of it.
 */
export function TriggerGroupCard({
  group,
  sentence,
  title,
  isOpen,
  onToggle,
  editor,
  onAddSteps,
}: TriggerGroupCardProps) {
  const parts = useMemo(() => triggerParts(group), [group]);
  const stepTitles = useStepTitles(parts.steps);
  const { byId: notRunning } = useNotRunningWorkflows();
  const { switchWorkflows, isSwitching } = useSwitchWorkflows();

  const anyOn = group.members.some((member) => member.row.isEnabled);
  const summary =
    stepTitles.length === 0 && parts.modules.length === 0
      ? "Your steps are paused"
      : triggerSummary(stepTitles, parts.modules.map(moduleStepsName));
  const unhealthy = group.members.flatMap((member) => {
    const health = member.row.isEnabled ? notRunning.get(member.row.engineWorkflowId) : undefined;
    return health ? [health] : [];
  })[0];
  const firstId = group.members[0].row.engineWorkflowId;
  const alsoRuns = parts.modules.length > 0 && (
    <AlsoRuns modules={parts.modules} afterSteps={parts.steps !== undefined} />
  );

  return (
    <article
      className={cn("rounded-2xl border bg-card", isOpen && "border-foreground/20")}
      data-testid={`trigger-card-${firstId}`}
    >
      <div className="relative flex items-center gap-2 py-2.5 pl-2 pr-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={`${title}. ${isOpen ? "Close" : "Open"}`}
          className="flex h-[52px] w-9 shrink-0 items-center justify-center rounded-[10px] after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:bg-accent"
          data-testid={`trigger-toggle-${firstId}`}
        >
          <ChevronRight
            className={cn("h-4 w-4 transition-transform duration-150", isOpen && "rotate-90")}
            aria-hidden="true"
          />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-1.5">
          <span className="text-base font-medium leading-snug">{sentence}</span>
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
            {!anyOn && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-px text-xs text-foreground/80">Paused</span>
            )}
            {unhealthy && (
              <span className="relative z-10 shrink-0">
                <NotRunningBadge health={unhealthy} />
              </span>
            )}
            <span className="truncate">{summary}</span>
          </span>
        </div>
        <div className="relative z-10 flex h-11 w-14 shrink-0 items-center justify-center">
          <Switch
            checked={anyOn}
            disabled={isSwitching}
            onCheckedChange={() => void switchWorkflows(group.members, !anyOn)}
            aria-label="Trigger on"
            data-testid={`trigger-enabled-${firstId}`}
          />
        </div>
      </div>

      {isOpen && (
        <div className="flex flex-col gap-4 border-t p-4 sm:p-5">
          <SeparateOwnSteps parts={parts} />
          {parts.steps ? (
            editor(parts.steps, alsoRuns || undefined)
          ) : (
            <>
              <Button variant="outline" className="h-11 self-start sm:h-9" onClick={onAddSteps}>
                Add your own steps
              </Button>
              {alsoRuns}
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** The streamer's steps that aren't part of the list: paused ones, and ones the engine couldn't merge into it. */
function SeparateOwnSteps({ parts }: { parts: TriggerParts }) {
  return (
    <>
      {parts.paused.map((trigger) => (
        <PausedSteps key={trigger.row.engineWorkflowId} trigger={trigger} />
      ))}
      {parts.apart.map((trigger) => (
        <ApartSteps key={trigger.row.engineWorkflowId} trigger={trigger} />
      ))}
    </>
  );
}

function PausedSteps({ trigger }: { trigger: EventTrigger }) {
  const titles = useStepTitles(trigger);
  const { switchWorkflows, isSwitching } = useSwitchWorkflows();
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3"
      data-testid={`paused-steps-${trigger.row.engineWorkflowId}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5 opacity-60">
        <span className="text-[13px] font-medium">Paused</span>
        <span className="truncate text-[13px]">{titles.join(", ")}</span>
      </div>
      <Button
        variant="outline"
        className="h-11 shrink-0 sm:h-9"
        disabled={isSwitching}
        onClick={() => void switchWorkflows([trigger], true)}
      >
        Resume
      </Button>
    </div>
  );
}

function ApartSteps({ trigger }: { trigger: EventTrigger }) {
  const [, navigate] = useLocation();
  const titles = useStepTitles(trigger);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium">{titles.join(", ")}</span>
        <span className="text-xs text-muted-foreground">
          Runs as well, but can't join the list while it's running or another workflow uses it.
        </span>
      </div>
      <Button
        variant="ghost"
        className="h-11 shrink-0 text-[13px] text-muted-foreground sm:h-9"
        onClick={() => navigate(`/stream/workflows/${trigger.row.engineWorkflowId}`)}
      >
        <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        Open
      </Button>
    </div>
  );
}

function AlsoRuns({ modules, afterSteps }: { modules: EventTrigger[]; afterSteps: boolean }) {
  return (
    <section aria-label="Also runs" className="flex flex-col gap-2" data-testid="also-runs">
      <h4 className="text-[13px] font-medium">{afterSteps ? "Also runs" : "Runs"}</h4>
      <div className="flex flex-col divide-y rounded-xl border">
        {modules.map((module) => (
          <ModuleRow key={module.row.engineWorkflowId} module={module} />
        ))}
      </div>
      {afterSteps && (
        <p className="text-xs text-muted-foreground">
          Starts when the steps above finish or reach a wait. Changing When moves only your steps.
        </p>
      )}
    </section>
  );
}

/** A module's workflow on this trigger: its name and switch. Its steps are the module's to change. */
function ModuleRow({ module }: { module: EventTrigger }) {
  const { row } = module;
  const { byId: notRunning } = useNotRunningWorkflows();
  const { switchWorkflows, isSwitching } = useSwitchWorkflows();
  const health = row.isEnabled ? notRunning.get(row.engineWorkflowId) : undefined;
  const name = moduleStepsName(module);
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2"
      data-testid={`module-row-${row.engineWorkflowId}`}
    >
      <span className={cn("flex min-w-0 items-center gap-2 text-sm", !row.isEnabled && "text-muted-foreground")}>
        <span className="truncate">{name}</span>
        {health && <NotRunningBadge health={health} />}
      </span>
      <div className="flex h-11 w-14 shrink-0 items-center justify-center">
        <Switch
          checked={row.isEnabled}
          disabled={isSwitching}
          onCheckedChange={() => void switchWorkflows([module], !row.isEnabled)}
          aria-label={`${name} on`}
          data-testid={`trigger-enabled-${row.engineWorkflowId}`}
        />
      </div>
    </div>
  );
}
