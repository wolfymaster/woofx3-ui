# Engine gateway

## Context

Screens reach the instance's engine through one interface, `EngineGateway` (`client/src/engine/gateway.ts`): one namespace per domain (status, scenes, workflows, commands, …), each a set of React hooks. `useEngineGateway()` returns the gateway the app booted with, and the hooks in `client/src/engine/hooks/` wrap its members for components.

Today the only implementation is the Convex one in `client/src/engine/convex/`. Its reads subscribe to the Convex functions that mirror engine state, and its requests call the Convex actions that relay to the engine. A second implementation that talks to the engine directly has to satisfy the same interface.

## Decision

The interface and its types (`client/src/engine/types.ts`) describe the engine's data as the UI uses it, and name no backend:

- **Ids are branded strings.** `InstanceId`, `ModuleId`, `MacroId` and `WebhookEventId` are opaque ids issued by a gateway. Branding stops one kind of id, or a backend's own id type, being passed where another is expected.
- **Payloads are declared, not derived.** A result type is the engine's own type from `@woofx3/api` when that is what the UI reads (`EngineInfo`, `ObsStatus`, `WidgetThemes`), and otherwise a UI domain type declared in `types.ts`. Nothing there is `Doc<…>`, `Id<…>`, `FunctionReturnType<…>` or imported from `convex/`.
- **Each implementation maps at its edge.** The Convex adapter turns rows and action results into the domain types with named functions (`toSceneRecord`, `toEngineAlert`, `toWorkflowCatalog`, …). Convex's own fields (`_id`, `_creationTime`, the row's `instanceId`) do not cross; where a screen needs a row's identity it gets a named field such as `id`. List reads are mapped under `useMemo`, so a mapped result keeps its identity until the Convex result changes.
- **Ids convert at the edge too.** `client/src/engine/convex/ids.ts` converts between the gateway ids and Convex document ids (`toInstanceId`, `fromInstanceId`, …). Code that holds a Convex id from a cloud-owned query, such as `useInstance().instance._id`, converts it with `toInstanceId` before calling the gateway.

`client/src/engine/boundary.test.ts` holds both sides of the line: files in `client/src/engine/` outside `convex/` may not import Convex modules or name Convex's generated types, and files outside `client/src/engine/` may not call the Convex functions a gateway namespace owns (`namespaces.ts`).

## Consequences

- A new gateway member gets a domain type in `types.ts` first, then a mapping in the Convex adapter. The adapter objects are typed as the namespace interfaces (`convexScenesGateway: ScenesGateway`), so a Convex shape that drifts from its domain type fails the type check.
- Records are keyed by what the engine knows them by (`engineCommandId`, `engineWorkflowId`, `canonicalId`) wherever one exists.
- A caller that shows a rejection's text reads `Error.message`. The Convex adapter rethrows a `ConvexError` carrying text as a plain `Error` where a caller does this (the capabilities request), so callers never depend on `ConvexError`.
