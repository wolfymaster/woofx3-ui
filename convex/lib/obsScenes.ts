/**
 * OBS's scenes as the engine's `listObsScenes()` reports them. Must match
 * `ObsSceneSource`, `ObsScene` and `ObsSceneListing` in
 * shared/clients/typescript/api/api.ts in the engine; declared here until the
 * engine checkout the UI builds against carries them.
 */
export interface ObsSceneSource {
  name: string;
  sceneItemId: number;
  /** OBS input kind (e.g. `browser_source`); null for a nested scene or group. */
  inputKind: string | null;
  /** Whether the source is currently shown in the scene. */
  enabled: boolean;
}

export interface ObsScene {
  name: string;
  sources: ObsSceneSource[];
}

export type ObsSceneListing = { available: true; scenes: ObsScene[] } | { available: false; reason: string };
