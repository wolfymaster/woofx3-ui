import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import type { ModuleResourceInstance } from "@/engine/types";
import type { ActionPreset } from "@/lib/workflow-presets";
import { ALERT_RECIPE_EVENT, type AlertRecipe, AlertRecipes, cheerAlertRecipes } from "./alert-recipes";

const icon = (() => null) as unknown as ActionPreset["icon"];

function preset(id: string, canonicalRef: string, config?: ActionPreset["config"]): ActionPreset {
  return {
    id,
    canonicalRef,
    name: id,
    description: "",
    icon,
    category: "",
    color: "",
    source: "",
    config,
  };
}

const presets = [
  preset("alert", "woofx3:action:alert"),
  preset("chat", "woofx3:action:chat.reply"),
  preset("counter", "woofx3:action:counter.increment", {
    fields: [
      {
        id: "target",
        label: "Counter",
        type: "resource_ref",
        resourceKind: "counter",
      } as never,
    ],
  }),
];

const counters = [
  {
    canonicalId: "woofx3:counter:hype",
    displayName: "Hype",
    kind: "counter",
  } as ModuleResourceInstance,
];

describe("cheerAlertRecipes", () => {
  test("offers the shared presets installed on this engine", () => {
    const recipes = cheerAlertRecipes(presets, counters);
    expect(recipes.map((recipe) => recipe.label)).toEqual([
      "Bits alert",
      "Hype counter",
      "Say thanks in chat",
      "Start from scratch",
    ]);
    expect(recipes[1].parameters).toEqual({ target: "woofx3:counter:hype" });
  });

  test("omits presets the engine cannot run", () => {
    expect(cheerAlertRecipes([], []).map((recipe) => recipe.label)).toEqual(["Start from scratch"]);
  });
});

describe("AlertRecipes", () => {
  test("renders an inline row only on the cheer event", async () => {
    const recipes: AlertRecipe[] = [{ id: "bits-alert", label: "Bits alert" }];
    const picks: string[] = [];
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <AlertRecipes event={ALERT_RECIPE_EVENT} recipes={recipes} onPick={(pick) => picks.push(pick.id)} />
      );
    });
    const button = renderer?.root.findByProps({ "data-testid": "alert-recipe-bits-alert" });
    await act(async () => {
      button.props.onClick();
    });
    expect(picks).toEqual(["bits-alert"]);

    let hidden: ReturnType<typeof create> | undefined;
    await act(async () => {
      hidden = create(<AlertRecipes event="user.message" recipes={recipes} onPick={() => undefined} />);
    });
    expect(hidden?.toJSON()).toBeNull();
  });
});
