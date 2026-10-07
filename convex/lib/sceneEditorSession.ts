/**
 * Opening sceneManager's scene editor socket.
 *
 * Declared here rather than imported because `@woofx3/api` does not export
 * them until the engine ships scene editor sessions. They must match
 * `SceneEditorSession` / `getSceneEditorSession` in the engine's
 * `shared/clients/typescript/api/api.ts` (capability `scenes.editorSessions`).
 * Once `@woofx3/api` exports them, import them from there and delete these.
 */

export interface SceneEditorSession {
  /** Presented once, as `?token=`, when the editor socket opens. */
  token: string;
  /** The editor socket, relative to sceneManager's public URL. */
  path: string;
  /** How long `token` may be presented for; ask again to reconnect after. */
  expiresInSeconds: number;
}

export interface SceneEditorSessionApi {
  getSceneEditorSession(sceneId: string): Promise<SceneEditorSession | null>;
}
