import { DEFAULT_ALERT_ITEMS } from "@shared/default-seed";
import { resourceKindMatches } from "@shared/resource-kinds";
import { STARTER_ACTION_REFS, STARTER_PACKS, type StarterWorkflowItem } from "@shared/starter-packs";
import type { ModuleResourceInstance } from "@/engine/types";
import { resourceActions } from "@/lib/resource-actions";
import type { ActionPreset } from "@/lib/workflow-presets";

function sharedBitsAlert() {
  const item = DEFAULT_ALERT_ITEMS.find((candidate) => candidate.id === "bits");
  if (item === undefined) {
    throw new Error("The shared default alerts have no bits item.");
  }
  return item;
}

function sharedCheerThanks() {
  const pack = STARTER_PACKS.find((candidate) => candidate.id === "cheer-thanks");
  const item = pack?.items.find(
    (candidate): candidate is StarterWorkflowItem => candidate.kind === "workflow" && candidate.id === "cheer-thanks"
  );
  if (item === undefined) {
    throw new Error("The shared starter packs have no cheer-thanks item.");
  }
  return item;
}

const BITS_ALERT = sharedBitsAlert();
const CHEER_THANKS = sharedCheerThanks();

const HYPE_COUNTER_ACTION = STARTER_ACTION_REFS.counterIncrement;
const HYPE_COUNTER_ID = "woofx3:counter:hype";

/** The one event these presets bind to, taken from the shared bits alert rather than repeated. */
export const ALERT_RECIPE_EVENT = BITS_ALERT.trigger.event;

export interface AlertRecipe {
  id: string;
  label: string;
  /** Absent for the blank starting point. */
  seed?: ActionPreset;
  /** Values the seed starts with, before the phrase is opened. */
  parameters?: Record<string, unknown>;
}

/**
 * The inline starting points for a cheer alert. Labels and action refs come from the
 * shared seeds and starter packs, so these buttons offer the same things an install does;
 * only what is installed on this engine can be offered.
 */
export function cheerAlertRecipes(
  actionPresets: readonly ActionPreset[],
  counters: readonly ModuleResourceInstance[]
): AlertRecipe[] {
  const byRef = (ref: string) => actionPresets.find((preset) => preset.canonicalRef === ref);
  const recipes: AlertRecipe[] = [];
  const bits = byRef(STARTER_ACTION_REFS.alert);
  if (bits) {
    recipes.push({ id: "bits-alert", label: BITS_ALERT.name, seed: bits });
  }

  const counter = byRef(HYPE_COUNTER_ACTION);
  const aimedCounter = resourceActions([...actionPresets], "counter").find((action) => action.preset === counter);
  const hype = counters.find(
    (row) =>
      row.canonicalId === HYPE_COUNTER_ID ||
      (resourceKindMatches(row.kind, "counter") && row.displayName.trim().toLowerCase() === "hype")
  );
  if (counter && aimedCounter && hype) {
    recipes.push({
      id: "hype-counter",
      label: "Hype counter",
      seed: counter,
      parameters: { [aimedCounter.fieldId]: hype.canonicalId },
    });
  }

  const thanks = byRef(CHEER_THANKS.steps.find((step) => step.kind === "action")?.action ?? "");
  if (thanks) {
    recipes.push({ id: "say-thanks", label: "Say thanks in chat", seed: thanks });
  }

  recipes.push({ id: "scratch", label: "Start from scratch" });
  return recipes;
}

interface AlertRecipesProps {
  event: string;
  recipes: readonly AlertRecipe[];
  onPick: (recipe: AlertRecipe) => void;
}

/** A quiet inline row above the trigger list: pick a first phrase and edit it in place. */
export function AlertRecipes({ event, recipes, onPick }: AlertRecipesProps) {
  if (event !== ALERT_RECIPE_EVENT || recipes.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-1" data-testid="alert-recipes">
      <span className="text-[13px] text-muted-foreground">Start with</span>
      {recipes.map((recipe) => (
        <button
          key={recipe.id}
          type="button"
          className="h-8 rounded-full border bg-card px-3 text-[13px] hover:bg-accent"
          onClick={() => onPick(recipe)}
          data-testid={`alert-recipe-${recipe.id}`}
        >
          {recipe.label}
        </button>
      ))}
    </div>
  );
}
