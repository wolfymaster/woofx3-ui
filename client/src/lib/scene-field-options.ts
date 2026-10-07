/**
 * Options for the `scenes` and `scenePlacements` field sources (woofx3
 * `ui-schema.ts`), which the `scene.widget.visibility` action's form uses: a
 * scene, then a widget placed on it. Values are the engine's ids, since the
 * action runs on the engine.
 */

export interface SceneOption {
  value: string;
  label: string;
}

interface SceneRow {
  engineSceneId?: string;
  name: string;
  widgets?: unknown[];
}

/** The scenes the engine knows, by name. */
export function sceneChoices(scenes: readonly SceneRow[]): SceneOption[] {
  return scenes
    .filter((scene): scene is SceneRow & { engineSceneId: string } => Boolean(scene.engineSceneId))
    .map((scene) => ({ value: scene.engineSceneId, label: scene.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The widgets placed on the scene whose engine id is `sceneId`, topmost
 * first as the layers list shows them. A widget placed twice is two choices;
 * placements the editor did not name are told apart by position.
 */
export function placementChoices(scenes: readonly SceneRow[], sceneId: unknown): SceneOption[] {
  const scene = typeof sceneId === "string" ? scenes.find((s) => s.engineSceneId === sceneId) : undefined;
  const placements = (scene?.widgets ?? []).filter(
    (w): w is { id: string; name?: unknown; widgetCanonicalId?: unknown; zIndex?: unknown } =>
      typeof w === "object" && w !== null && typeof (w as { id?: unknown }).id === "string"
  );
  const ordered = placements
    .map((placement, index) => ({ placement, index }))
    .sort((a, b) => zIndexOf(b.placement, b.index) - zIndexOf(a.placement, a.index));
  return ordered.map(({ placement }, rank) => {
    const named = typeof placement.name === "string" && placement.name.trim() !== "" ? placement.name : null;
    const widget =
      typeof placement.widgetCanonicalId === "string"
        ? (placement.widgetCanonicalId.split(":widget:")[1] ?? placement.widgetCanonicalId)
        : "widget";
    return { value: placement.id, label: named ?? `${widget} #${ordered.length - rank}` };
  });
}

function zIndexOf(placement: { zIndex?: unknown }, index: number): number {
  return typeof placement.zIndex === "number" ? placement.zIndex : index;
}
