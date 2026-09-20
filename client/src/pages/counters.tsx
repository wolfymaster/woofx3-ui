import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { Minus, Plus, RotateCcw, Tally5 } from "lucide-react";
import { useState } from "react";
import { type ResourceDetailProps, ResourceKindPage } from "@/components/resources/resource-kind-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { resourceActionStep } from "@/lib/resource-actions";

const BASE_PATH = "/stream/counters";

export default function Counters() {
  return (
    <ResourceKindPage
      kind="counter"
      title="Counters"
      description="Numbers your stream keeps: deaths, wins, hugs given. Change them here, from a chat command, or from any workflow."
      icon={Tally5}
      basePath={BASE_PATH}
      railValue={(props) => formatCount(counterValue(props))}
      detail={(props) => <CounterPanel {...props} />}
    />
  );
}

/**
 * A counter's number reads as its starting value until something changes it,
 * and again after a session value is cleared.
 */
function counterValue({ value, settings }: ResourceDetailProps): number {
  const stored = Number(value);
  if (value !== null && value !== undefined && Number.isFinite(stored)) {
    return stored;
  }
  const initial = Number(settings.initialValue);
  return Number.isFinite(initial) ? initial : 0;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

/**
 * The counter's number and what can be done to it. Each button runs the
 * counter's own action — the same one a workflow or a chat command would — so
 * the page never changes a value any other way, and the number shown is the one
 * the engine stored, arriving back through its change event.
 */
function CounterPanel(props: ResourceDetailProps) {
  const { instance, moduleName, settings } = props;
  const { instance: engineInstance } = useInstance();
  const { actionPresets } = useWorkflowCatalog();
  const runActions = useAction(api.moduleResourceActions.runActions);
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [setTo, setSetTo] = useState("");

  const step = Number(settings.step) || 1;

  async function run(actionId: string, parameters: Record<string, unknown> = {}) {
    if (!engineInstance) {
      return;
    }
    setPending(actionId);
    try {
      const action = resourceActionStep(actionPresets, moduleName, actionId, {
        target: instance.canonicalId,
        ...parameters,
      });
      await runActions({
        instanceId: engineInstance._id,
        label: `dashboard:${instance.canonicalId}`,
        actions: escapeDollarKeys([action]) as unknown[],
      });
    } catch (err) {
      toast({
        title: "That didn't work",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setPending(null);
    }
  }

  const setValue = Number(setTo);
  const canSet = setTo.trim() !== "" && Number.isFinite(setValue);

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-center gap-6">
        <Button
          variant="outline"
          size="icon"
          className="h-12 w-12 rounded-full"
          disabled={pending !== null}
          onClick={() => void run("counter.decrement")}
          aria-label={`Take ${step} away`}
          data-testid="button-counter-decrement"
        >
          <Minus className="h-5 w-5" />
        </Button>
        <span className="min-w-[4ch] text-center text-6xl font-semibold tabular-nums" data-testid="text-counter-value">
          {formatCount(counterValue(props))}
        </span>
        <Button
          size="icon"
          className="h-12 w-12 rounded-full"
          disabled={pending !== null}
          onClick={() => void run("counter.increment")}
          aria-label={`Add ${step}`}
          data-testid="button-counter-increment"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSet) {
              void run("counter.set", { value: setValue }).then(() => setSetTo(""));
            }
          }}
        >
          <Input
            type="number"
            value={setTo}
            onChange={(e) => setSetTo(e.target.value)}
            placeholder="Set to…"
            className="w-28"
            data-testid="input-counter-set"
          />
          <Button type="submit" variant="outline" disabled={!canSet || pending !== null}>
            Set
          </Button>
        </form>
        <Button
          variant="ghost"
          disabled={pending !== null}
          onClick={() => void run("counter.reset")}
          data-testid="button-counter-reset"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        To change it from chat or a workflow, add the Increment counter action and choose {instance.displayName}.
      </p>
    </Card>
  );
}
