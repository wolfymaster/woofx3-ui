## 2026-05-15 - Task Started

**Plan**: `.sisyphus/plans/module-connection-architecture.md`

**Initial State**:
- T1 (proto): N/A - this is UI repo, no proto files
- T2-T5 (ConnectionManager): Belongs in engine repo
- T6-T10 (module system): Belongs in engine repo
- T11-T13 (OBS module): Belongs in engine repo
- T14 (UI config): Can be built in UI repo
- T15 (integration test): Needs engine + UI
- T16 (deprecation warning): N/A - no OBS Controller file exists
- T17 (migration docs): N/A - no source to migrate from
- T18 (final testing): After engine-side work complete

**Feasible Work in UI Repo**:
1. T14: OBS settings UI tab + Convex API for config storage
2. Create obsSceneConfigs Convex functions for CRUD operations
3. Build UI for OBS WebSocket URL/password configuration

**Key Files**:
- `convex/schema.ts` lines 438-467: obsSceneConfigs table defined but unused
- `convex/http.ts` lines 499-544: OBS commands HTTP endpoints
- `client/src/pages/settings.tsx`: Settings page (no OBS tab yet)
- `client/src/pages/obs-controller.tsx`: DOES NOT EXIST

**Dependencies**:
- T14 depends on engine connection management infrastructure
- UI stores config; engine manages actual WebSocket connection