import { internal } from "../../../_generated/api";
import type { EngineApi } from "../../engineInstanceUrl";
import { ENGINE_SYNC_CONFIG } from "../config";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * scenesStep — full-snapshot reconciliation of engine scenes.
 *
 * Pulls the engine's `getScenes()` snapshot one page at a time, then
 * forwards the complete set to `internal.engineSyncInternal.reconcileScenes`.
 * The engine is the source of truth for scene presence: rows whose
 * `engineSceneId` is missing from the snapshot are deleted.
 *
 * Engine `Scene` shape (see `@woofx3/api`):
 *   { id, name, widgets, createdAt }
 * Only `id` and `name` are forwarded. The wire `widgets` are a lossy
 * projection of the scene's widget JSON; the full JSON, along with the
 * description and layout, arrives only through the scene webhooks. See
 * `reconcileScenes`.
 */
export const scenesStep: SyncStep = {
  name: "scenes",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    type ScPage = Awaited<ReturnType<EngineApi["getScenes"]>>;
    const all: ScPage["scenes"] = [];
    let page = 1;
    while (true) {
      // Each page is a separate engine RPC — capnweb sessions are single-use,
      // so we must open a fresh session per page.
      const api = newApi();
      const res = (await api.getScenes({
        page,
        pageSize: ENGINE_SYNC_CONFIG.pageSize,
      })) as ScPage;
      const scenes = res.scenes ?? [];
      all.push(...scenes);
      if (scenes.length < ENGINE_SYNC_CONFIG.pageSize) {
        break;
      }
      page++;
      if (page > 1000) {
        throw new Error("Scene pagination exceeded 1000 pages — aborting to avoid runaway");
      }
    }

    const upserts = all.map((s) => ({
      engineSceneId: s.id,
      name: s.name,
    }));
    const engineIds = upserts.map((u) => u.engineSceneId);

    return await ctx.runMutation(internal.engineSyncInternal.reconcileScenes, {
      instanceId,
      engineIds,
      upserts,
    });
  },
};
