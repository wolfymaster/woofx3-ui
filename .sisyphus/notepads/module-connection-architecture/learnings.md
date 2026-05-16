# Module Connection Architecture - Notepad

## Project Understanding (Updated after codebase analysis)

**Key Finding**: This is the woofx3-ui repository (Convex + React frontend). The engine-side code lives in a separate repository (`woofx3/api`). The ConnectionManager and proto files reference Go paths that don't exist here.

**Architecture Reality**:
- This repo: Convex backend + React frontend (UI control plane)
- Engine repo: Go backend with barkloader, module system (separate repo)
- Connection management infrastructure (T2-T5, T7-T10) belongs in ENGINE repo, not UI repo

**What can be built in this UI repo**:
- OBS settings UI tab (T14)
- OBS Module Convex functions (configuration storage)
- OBS triggers/actions integration with workflow builder
- Migration docs

**What belongs in engine repo**:
- ConnectionManager interface (T2)
- WebSocket client with reconnection (T3)
- Connection CRUD service (T4-T5)
- Barkloader runtime hooks (T7)
- Module SDK connection API (T8)
- Trigger emission (T9)
- OBS Module implementation (T11-T13)
- Unit tests (T10)

## Decisions

- 2026-05-15: Clarified that Wave 1-3 (engine-side) belongs in woofx3 repo. UI repo handles T14-T18 (UI integration).
- 2026-05-15: T1 proto extension not applicable - this repo doesn't have proto files.
- 2026-05-15: Plan adjusted to focus on feasible UI-side work.

## Issues

- Plan references paths that don't exist in this repo
- T16 "OBS Controller" deprecation not applicable - no such file exists
- T17 migration docs not applicable without source implementation

## Problems

- Need to understand where OBS Module should live (engine repo module system?)
- Connection management requires engine-side implementation first
- UI can only provide configuration storage and display