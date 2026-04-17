# configSchema / paramsSchema — contract between engine and UI

## Context

The engine's `TriggerDefinition` (`@woofx3/api/webhooks`) carries a
`configSchema: string` field; `ActionDefinition` carries `paramsSchema:
string`. Both are **opaque** on the engine side — the engine treats
them as arbitrary payloads sourced from the module manifest and
forwards them unchanged to registered clients via webhook.

Every consumer has to parse these strings into something it can
render. Without a convention, each client invents its own layout and
the UI can't rely on any field being present.

## Decision

The payload is **JSON**. When parsed, the result is one of the shapes
recognized by `@woofx3/api/ui-schema`:

1. **Array** — interpreted as `ConfigField[]` (the full fields list).
   All other presentation metadata falls back to defaults.

   ```json
   [
     { "id": "amount", "label": "Bits", "type": "number", "min": 1 },
     { "id": "message", "label": "Message", "type": "text" }
   ]
   ```

2. **Object** — interpreted as `TriggerConfig` (or `ActionConfig`)
   with `fields`, `supportsTiers`, `tierLabel`. Presentation
   overrides (`color`, `icon`) may appear at the top level **or**
   under a nested `ui` key; the UI checks both locations and prefers
   the top-level value when both are present.

   ```json
   {
     "color": "#6441a5",
     "icon": "Twitch",
     "fields": [
       { "id": "tier", "label": "Subscription Tier", "type": "select",
         "options": [{ "value": "1", "label": "Tier 1" }] }
     ],
     "supportsTiers": true,
     "tierLabel": "Sub months"
   }
   ```

3. **Empty string / unparseable** — treated as no config. The UI
   renders with full defaults (`color: "#888888"`, a neutral Lucide
   icon, empty `fields`).

## Consequences

- The engine never validates presentation data. Anything the module
  ships ends up in `configSchema`; correctness is the module's
  responsibility.
- The UI is free to set reasonable defaults for any required field
  the parsed payload omits. See `translateTrigger` /
  `translateAction` in `convex/moduleWebhook.ts`.
- Schema evolution: adding a new optional `ConfigField` property is
  non-breaking — old manifests render with the default. Renaming or
  tightening an existing property requires either a module-manifest
  migration or a UI fallback that accepts both names.
- `ConfigField` and `TriggerConfig` live in `@woofx3/api/ui-schema`.
  Changes there need to be coordinated between the engine's module
  authors and every UI that renders triggers/actions.

## See also

- `@woofx3/api/ui-schema` — the authoritative TypeScript shape.
- `convex/moduleWebhook.ts` — engine payload → Convex row translator.
- `docs/ui/modules.md` — end-to-end install / uninstall pipeline.
