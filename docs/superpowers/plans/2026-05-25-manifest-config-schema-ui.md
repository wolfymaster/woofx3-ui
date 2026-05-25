# Manifest Config Schema UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make woofx3-ui fully interpret barkloader manifest `schema` / engine `configSchema` / `paramsSchema` as `ConfigField[]`, including dynamic `source.kind: "internal"` selects and `allowVariants` multi-binding UX.

**Architecture:** Treat `@woofx3/api/ui-schema` (in `woofx3/shared/clients/typescript/api`) as the contract. Parse and render schema fields opaquely — values land in `trigger.conditions` and action `parameters`; actions read `${trigger.data.*}` as needed. Catalog ingest follows **engine sync as source of truth**. Variants do **not** use `condition` tasks; each variant becomes a **separate workflow** with the same trigger event/`$ref` and variant-specific `trigger.conditions`. Shared `ConfigurationForm` powers basic editor and React Flow builder.

**Tech Stack:** React 18, Convex (actions + `transientEvents`), capnweb engine RPC (`dispatchFieldOptionsRequest`), `@woofx3/api/ui-schema`, Biome, bun test.

---

## Product decisions (confirmed 2026-05-25)

| Topic | Decision |
|-------|----------|
| **`allowVariants`** | Multiple bindings of the same trigger declaration — each variant is the same trigger “shape” with different schema values (e.g. cheer varies on `amount`). |
| **Variant → workflow JSON** | **Not** `condition` tasks in `tasks[]`. Variant config becomes **`trigger.conditions`** on a normal `trigger` object. Engine evaluates those before the workflow runs. |
| **Multiple variants on save** | Engine stores **one `trigger_json` per workflow row**. Emit **one `WorkflowDefinition` per variant** (batch `createWorkflow` from the wizard). Each definition: shared `event` / `$ref`, variant `conditions`, single action task. |
| **`supportsTiers`** | **Legacy — remove** from UI paths, seeds, and catalog mapping. Use **`allowVariants` only**. |
| **Catalog source of truth** | **Engine** (`engineSyncInternal` / `getTriggers`). Webhooks align Convex; sync wins on conflict. |
| **`internal` options** | Assume success for v1 (minimal error UX). Support **multiple** dynamic-source fields per trigger. |
| **Field types** | Render manifest types in forms; do not over-validate. Values flow into workflow JSON / `trigger.data` for actions to consume. |
| **`media` type** | Maps to **instance asset library** picker (same as today’s media field), not module-only asset IDs. |
| **`ui-schema` changes** | Land in **`woofx3/shared/clients/typescript/api`**, sibling checkout consumed by woofx3-ui. |
| **React Flow builder** | **In scope** — reuse `ConfigurationForm` + parsers (node config panels). |
| **Existing workflows** | Only **wolfy_profile** bundled workflows matter; adjust manifest/workflows there if emission shape changes (e.g. cheer `amount`). |

**Cheer / `amount` note:** `wolfy_profile` templates use `${trigger.data.amount}`. Twitch manifest today uses `minBits` → `eventPath: "bits"`. For variant UX, align manifest cheer schema to `id: "amount"` (and `eventPath: "amount"` or whatever the EventSub payload uses) **or** document a one-time manifest edit in `twitch_platform` as part of this work.

**Engine schema note:** Published `WorkflowDefinition` has a singular `trigger` field (`workflow/internal/types/types.go`). “Multiple triggers” means **multiple workflow documents**, not a `triggers[]` array on one definition.

---

## Contract summary (agreed interface)

**Ingress:** Trigger `configSchema` and action `paramsSchema` are JSON strings. Parsed shape is either:

1. Bare `ConfigField[]` (manifest `schema` array — most modules), or
2. `{ fields, color?, icon? }` (optional presentation wrapper; **no `supportsTiers`**).

**Trigger-only:** `allowVariants: boolean` on the engine trigger row (`TriggerDefinition.allowVariants`). When true, the editor lets users add multiple **variants** (same trigger, different schema values + action). Saving creates **one workflow per variant**.

**ConfigField** (authoritative: `woofx3/shared/clients/typescript/api/ui-schema.ts`, documented in `woofx3/docs/barkloader/modules.md`):

| Property | Purpose |
|----------|---------|
| `id`, `label`, `type` | Form identity and renderer |
| `source.kind` | `"internal"` (NATS via engine) or `"commands"` (Convex chat commands) |
| `eventPath`, `operator` | Map field value → `trigger.conditions[]` on payload |
| `description`, `hint`, `dataSchema` | Inline help + info popover |
| `options`, `min`, `max`, `defaultValue`, … | Static field behavior |

**Source semantics (must not conflate):**

| `source.kind` | Event subject | Conditions |
|---------------|---------------|------------|
| `commands` | Append `.<value>` to base event | None (value is in subject) |
| `internal` | Unchanged base event | `{ field: "${trigger.data.<eventPath>}", operator, value }` |
| (none) | Unchanged | One condition per configured field using `eventPath` / `operator` |

**Worked examples:**

- `redeem.channelpoints.twitch` — `allowVariants` + `select` + `internal` + `eventPath: "rewardId"`
- `cheer.user.twitch` — `allowVariants` + `number` on field `amount` (align manifest) + `operator: "gte"`
- Chat command triggers — `commands` source (already partially implemented)

---

## Current gaps (baseline)

| Area | Status |
|------|--------|
| `parseConfigFieldSource` | Drops `internal` |
| `normalizeConfigFields` | Drops `eventPath`, `operator`, `description`, `hint`, `dataSchema` |
| `engineSyncInternal.triggerUiFields` | Ignores bare-array `configSchema` |
| `ConfigurationForm` | No `internal` renderer; no description/dataSchema popover |
| `dispatchFieldOptionsRequest` | Engine exists; no Convex action or `useFieldOptions` hook |
| `workflow-presets-json` | Treats all `source` as subject suffix; ignores `eventPath`/`operator` |
| `allowVariants` | Stored on catalog row; UI gates on legacy `supportsTiers` instead |
| `buildTieredDefinition` | Uses `condition` tasks — **wrong**; must emit per-variant `trigger.conditions` |
| `supportsTiers` | Still in seeds / catalog — **remove** |
| React Flow builder | Does not use manifest-driven `ConfigurationForm` yet |

---

## File map

| File | Responsibility |
|------|----------------|
| `shared/clients/typescript/api/ui-schema.ts` (woofx3) | Extend `ConfigFieldType`; add `allowVariants` to `TriggerConfig` doc |
| `client/src/lib/parse-config-fields.ts` | **Create** — canonical normalizer + tests |
| `client/src/hooks/use-workflow-catalog.ts` | Use normalizer; map `allowVariants` |
| `convex/lib/parseConfigSchema.ts` | **Create** — server-side same logic (no `@/` imports) |
| `convex/moduleWebhook.ts` | Use shared pick + parse for `configFields` |
| `convex/engineSyncInternal.ts` | Fix bare-array `configSchema`; preserve `allowVariants` |
| `convex/fieldOptions.ts` | **Create** — proxy `dispatchFieldOptionsRequest` |
| `client/src/hooks/use-field-options.ts` | **Create** — transientEvents subscription |
| `client/src/components/common/configuration-form.tsx` | Renderers + metadata UI |
| `client/src/components/common/config-field-label.tsx` | **Create** — description + info popover |
| `client/src/lib/workflow-presets.ts` | `allowVariants` on `TriggerPreset`; rename `TierConfig` → `TriggerVariant` (alias old name) |
| `client/src/lib/workflow-presets-json.ts` | Schema-aware conditions + variant builder |
| `client/src/components/workflows/basic-editor.tsx` | Wire `allowVariants` |
| `docs/patterns/config-schema.md` | Document internal + variants |

---

### Task 1: Extend ui-schema types (woofx3 shared package)

**Files:**
- Modify: `woofx3/shared/clients/typescript/api/ui-schema.ts`
- Modify: `woofx3-ui` imports only — no duplicate types

- [ ] **Step 1: Extend `ConfigFieldType`**

Add manifest field types and alias:

```typescript
export type ConfigFieldType =
  | "number"
  | "range"
  | "text"
  | "select"
  | "media"
  | "toggle"
  | "boolean" // alias → render as toggle
  | "color"
  | "asset"
  | "resource_ref";
```

- [ ] **Step 2: Extend `ConfigField` for pickers**

```typescript
export interface ConfigField {
  // ...existing...
  /** For `type: "asset"` — filter module assets by ManifestAsset.kind */
  kinds?: string[];
  /** For `type: "resource_ref"` — required resource kind discriminator */
  resourceKind?: string;
}
```

(Map manifest `kind` → `resourceKind` in the normalizer to avoid TS reserved word confusion.)

- [ ] **Step 3: Document `allowVariants` on `TriggerConfig`**

```typescript
export interface TriggerConfig {
  fields: ConfigField[];
  allowVariants?: boolean;
}
```

Remove `supportsTiers` / `tierLabel` from the shared type (and from Convex `triggerDefinitions` usage in a follow-up migration if columns remain for old rows).

- [ ] **Step 4: Verify consumers compile**

Run from `woofx3-ui`:

```bash
bun run check
```

Expected: PASS (may require fixing exhaustive switches if any).

---

### Task 2: Canonical `parseConfigFields` + tests

**Files:**
- Create: `client/src/lib/parse-config-fields.ts`
- Create: `client/src/lib/parse-config-fields.test.ts`
- Modify: `client/src/hooks/use-workflow-catalog.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// client/src/lib/parse-config-fields.test.ts
import { describe, expect, test } from "bun:test";
import { parseConfigField, parseConfigFields } from "./parse-config-fields";

describe("parseConfigFields", () => {
  test("parses internal source and eventPath metadata", () => {
    const fields = parseConfigFields([
      {
        id: "rewardId",
        label: "Reward",
        type: "select",
        source: {
          kind: "internal",
          request: { event: "twitchapi", payload: { command: "listChannelPointRewards" } },
          timeoutMs: 10000,
        },
        eventPath: "rewardId",
        operator: "eq",
        description: "Only fire when the redemption matches this reward.",
        hint: "Loaded from Twitch.",
        dataSchema: '{"rewardId":"..."}',
      },
    ]);
    expect(fields).toHaveLength(1);
    expect(fields[0].source).toEqual({
      kind: "internal",
      request: { event: "twitchapi", payload: { command: "listChannelPointRewards" } },
      timeoutMs: 10000,
    });
    expect(fields[0].eventPath).toBe("rewardId");
    expect(fields[0].operator).toBe("eq");
    expect(fields[0].description).toBe("Only fire when the redemption matches this reward.");
  });

  test("normalizes boolean to toggle", () => {
    const [f] = parseConfigFields([{ id: "x", label: "X", type: "boolean" }]);
    expect(f.type).toBe("toggle");
  });

  test("maps resource_ref kind field", () => {
    const [f] = parseConfigFields([{ id: "counter", label: "Counter", type: "resource_ref", kind: "counter" }]);
    expect(f.type).toBe("resource_ref");
    expect(f.resourceKind).toBe("counter");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /home/wolfy/code/wolfymaster/woofx3-ui && bun test client/src/lib/parse-config-fields.test.ts
```

- [ ] **Step 3: Implement `parse-config-fields.ts`**

```typescript
import type { ConditionOperator } from "@woofx3/api";
import type { ConfigField, ConfigFieldSource, ConfigFieldType } from "@woofx3/api/ui-schema";

const FIELD_TYPES = new Set<ConfigFieldType>([
  "number", "range", "text", "select", "media", "toggle", "color", "asset", "resource_ref",
]);

function normalizeFieldType(raw: string): ConfigFieldType | null {
  if (raw === "boolean") {
    return "toggle";
  }
  if (FIELD_TYPES.has(raw as ConfigFieldType)) {
    return raw as ConfigFieldType;
  }
  return null;
}

export function parseConfigFieldSource(raw: unknown): ConfigFieldSource | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  if (o.kind === "commands") {
    return { kind: "commands" };
  }
  if (o.kind === "internal" && o.request && typeof o.request === "object") {
    const req = o.request as Record<string, unknown>;
    if (typeof req.event === "string") {
      return {
        kind: "internal",
        request: {
          event: req.event,
          payload:
            req.payload && typeof req.payload === "object"
              ? (req.payload as Record<string, unknown>)
              : undefined,
        },
        timeoutMs: typeof o.timeoutMs === "number" ? o.timeoutMs : undefined,
      };
    }
  }
  return undefined;
}

const OPERATORS = new Set<ConditionOperator>([
  "eq", "ne", "gt", "gte", "lt", "lte", "contains", "starts_with", "ends_with",
  "in", "not_in", "exists", "not_exists", "regex", "between",
]);

export function parseConfigField(item: unknown): ConfigField | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const o = item as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  const label = typeof o.label === "string" ? o.label : null;
  const type = typeof o.type === "string" ? normalizeFieldType(o.type) : null;
  if (!id || !label || !type) {
    return null;
  }
  const field: ConfigField = {
    id,
    label,
    type,
    required: o.required === true,
    placeholder: typeof o.placeholder === "string" ? o.placeholder : undefined,
    unit: typeof o.unit === "string" ? o.unit : undefined,
    min: typeof o.min === "number" ? o.min : undefined,
    max: typeof o.max === "number" ? o.max : undefined,
    defaultValue: o.defaultValue,
    description: typeof o.description === "string" ? o.description : undefined,
    hint: typeof o.hint === "string" ? o.hint : undefined,
    dataSchema: typeof o.dataSchema === "string" ? o.dataSchema : undefined,
    eventPath: typeof o.eventPath === "string" ? o.eventPath : undefined,
    operator:
      typeof o.operator === "string" && OPERATORS.has(o.operator as ConditionOperator)
        ? (o.operator as ConditionOperator)
        : undefined,
    mediaType:
      o.mediaType === "image" || o.mediaType === "audio" || o.mediaType === "video"
        ? o.mediaType
        : undefined,
    kinds: Array.isArray(o.kinds)
      ? o.kinds.filter((k): k is string => typeof k === "string")
      : undefined,
    resourceKind: typeof o.kind === "string" && type === "resource_ref" ? o.kind : undefined,
  };
  if (Array.isArray(o.options)) {
    field.options = o.options
      .filter(
        (opt): opt is { value: string; label: string } =>
          !!opt &&
          typeof opt === "object" &&
          typeof (opt as { value?: unknown }).value === "string" &&
          typeof (opt as { label?: unknown }).label === "string",
      )
      .map((opt) => ({ value: opt.value, label: opt.label }));
  }
  const source = parseConfigFieldSource(o.source);
  if (source) {
    field.source = source;
  }
  return field;
}

export function parseConfigFields(raw: unknown): ConfigField[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ConfigField[] = [];
  for (const item of raw) {
    const f = parseConfigField(item);
    if (f) {
      out.push(f);
    }
  }
  return out;
}

/** Parse configSchema / paramsSchema string or object into fields array. */
export function parseConfigSchemaPayload(parsed: unknown): {
  fields: ConfigField[];
  supportsTiers?: boolean;
  tierLabel?: string;
  color?: string;
  icon?: string;
} {
  if (Array.isArray(parsed)) {
    return { fields: parseConfigFields(parsed) };
  }
  if (!parsed || typeof parsed !== "object") {
    return { fields: [] };
  }
  const obj = parsed as Record<string, unknown>;
  const nested = obj.ui && typeof obj.ui === "object" ? (obj.ui as Record<string, unknown>) : obj;
  const rawFields = Array.isArray(nested.fields)
    ? nested.fields
    : Array.isArray(nested.configFields)
      ? nested.configFields
      : [];
  return {
    fields: parseConfigFields(rawFields.length > 0 ? rawFields : parsed),
    supportsTiers: typeof nested.supportsTiers === "boolean" ? nested.supportsTiers : undefined,
    tierLabel: typeof nested.tierLabel === "string" ? nested.tierLabel : undefined,
    color: typeof nested.color === "string" ? nested.color : undefined,
    icon: typeof nested.icon === "string" ? nested.icon : undefined,
  };
}
```

Fix `parseConfigSchemaPayload` bare-array branch: when `Array.isArray(parsed)`, use `parseConfigFields(parsed)` only (remove erroneous fallback).

- [ ] **Step 4: Wire `use-workflow-catalog.ts`**

Replace local `normalizeConfigFields` / `parseConfigFieldSource` with imports from `@/lib/parse-config-fields`.

In `toTriggerPreset`:

```typescript
config:
  fields.length > 0 || row.allowVariants
    ? { fields, allowVariants: row.allowVariants === true }
    : undefined,
```

- [ ] **Step 5: Run tests**

```bash
bun test client/src/lib/parse-config-fields.test.ts
bun run check
```

Expected: PASS

---

### Task 3: Convex ingest preserves full schema

**Files:**
- Create: `convex/lib/parseConfigSchema.ts` (duplicate logic — Convex cannot import `client/`)
- Modify: `convex/moduleWebhook.ts`
- Modify: `convex/engineSyncInternal.ts`

- [ ] **Step 1: Add `convex/lib/parseConfigSchema.ts`**

Port `parseConfigFields` / `parseConfigSchemaPayload` from Task 2 (same behavior, no React imports). Export `parseConfigSchemaString(raw: string | undefined)`.

- [ ] **Step 2: Fix `moduleWebhook.ts` `pickUi`**

When parsed value is `Array`, return `{ configFields: parseConfigFields(parsed) }` (typed as `unknown[]` for Convex `v.any()` storage — values are normalized objects).

- [ ] **Step 3: Fix `engineSyncInternal.ts` `triggerUiFields`**

```typescript
function triggerUiFields(configSchema: string | undefined) {
  const parsed = parseJsonSafe(configSchema);
  if (Array.isArray(parsed)) {
    return {
      color: DEFAULT_UI_COLOR,
      icon: DEFAULT_TRIGGER_ICON,
      configFields: parseConfigFields(parsed),
    };
  }
  // ...existing object branch using parseConfigSchemaPayload...
}
```

Mirror for action `paramsSchema` if actions use bare arrays (same pattern in `actionUiFields`).

- [ ] **Step 4: Manual verification**

After `bunx convex dev` + module install webhook, inspect `triggerDefinitions` row for `twitch_platform:trigger:redeem.channelpoints.twitch`:

- `configFields[0].source.kind === "internal"`
- `allowVariants === true`

---

### Task 4: Convex `fieldOptions` action + `useFieldOptions` hook

**Files:**
- Create: `convex/fieldOptions.ts`
- Create: `client/src/hooks/use-field-options.ts`
- Create: `client/src/hooks/use-field-options.test.ts` (transform unit tests only)

- [ ] **Step 1: Implement Convex action**

```typescript
// convex/fieldOptions.ts
"use node"; // only if needed — prefer default runtime; fetch/RPC works without node

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

const descriptorValidator = v.object({
  kind: v.literal("internal"),
  request: v.object({
    event: v.string(),
    payload: v.optional(v.any()),
  }),
  timeoutMs: v.optional(v.number()),
});

export const dispatch = action({
  args: {
    instanceId: v.id("instances"),
    descriptor: descriptorValidator,
    correlationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
      instanceId: args.instanceId,
      userId,
    });
    if (!bundle?.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.dispatchFieldOptionsRequest(args.descriptor, args.correlationKey);
    return { correlationKey: args.correlationKey };
  },
});
```

- [ ] **Step 2: Implement `defaultTransform` + hook**

```typescript
// client/src/hooks/use-field-options.ts
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InternalConfigFieldSource } from "@woofx3/api/ui-schema";
import type { Id } from "@convex/_generated/dataModel";

export type FieldOption = { value: string; label: string };

export function defaultTransform(data: unknown): FieldOption[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const out: FieldOption[] = [];
  for (const item of data) {
    if (typeof item === "string") {
      out.push({ value: item, label: item });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.value === "string" && typeof o.label === "string") {
        out.push({ value: o.value, label: o.label });
      }
    }
  }
  return out;
}

export function useFieldOptions(
  instanceId: Id<"instances"> | undefined,
  source: InternalConfigFieldSource | undefined,
): { options: FieldOption[]; loading: boolean; error: string | null; empty: boolean } {
  const dispatch = useAction(api.fieldOptions.dispatch);
  const [correlationKey, setCorrelationKey] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!instanceId || !source || started.current) {
      return;
    }
    started.current = true;
    const key = crypto.randomUUID();
    setCorrelationKey(key);
    dispatch({ instanceId, descriptor: source, correlationKey: key }).catch(() => {
      /* surfaced via transient event error */
    });
  }, [instanceId, source, dispatch]);

  const event = useQuery(
    api.transientEvents.get,
    instanceId && correlationKey ? { instanceId, correlationKey } : "skip",
  );

  const timeoutMs = source?.timeoutMs ?? 10_000;

  // Optional: local timeout if webhook never arrives

  return useMemo(() => {
    if (!instanceId || !source) {
      return { options: [], loading: false, error: null, empty: true };
    }
    if (!event) {
      return { options: [], loading: true, error: null, empty: false };
    }
    if (event.status === "error") {
      return { options: [], loading: false, error: event.message ?? "Request failed", empty: true };
    }
    const options = defaultTransform(event.data);
    return {
      options,
      loading: false,
      error: null,
      empty: options.length === 0,
    };
  }, [instanceId, source, event]);
}
```

- [ ] **Step 3: Test transform**

```bash
bun test client/src/hooks/use-field-options.test.ts
```

---

### Task 5: ConfigurationForm — internal select + field metadata

**Files:**
- Create: `client/src/components/common/config-field-label.tsx`
- Modify: `client/src/components/common/configuration-form.tsx`

- [ ] **Step 1: `ConfigFieldLabel` component**

- Renders `label` + required asterisk
- If `hint` or `dataSchema`: `Popover` with info icon (pin on click)
- Render `dataSchema` in `<pre>` with basic JSON highlight (or monospace block)

- [ ] **Step 2: `InternalSelectFieldRenderer`**

Mirror `CommandsSelectFieldRenderer`; use `useFieldOptions(instanceId, field.source)` when `source.kind === "internal"`.

Branch in `ConfigurationForm` map loop (before type dispatch):

```typescript
if (source?.kind === "internal") {
  return <InternalSelectFieldRenderer key={field.id} ... />;
}
if (source?.kind === "commands") {
  return <CommandsSelectFieldRenderer key={field.id} ... />;
}
```

- [ ] **Step 3: Use `description` below control**

All builtin renderers: show `field.description` as muted text (distinct from `hint` in popover).

- [ ] **Step 4: Add `ColorFieldRenderer`**

Native `<input type="color" />`.

- [ ] **Step 5: Add `ResourceRefFieldRenderer`**

`useQuery(api.moduleResourceInstances.listByKind, { instanceId, kind: field.resourceKind })` → select of `canonicalId` / `displayName`.

- [ ] **Step 6: Extend `TriggerConfigForm` asset renderer**

Support manifest `type: "asset"` with optional `kinds` filter (module-scoped assets — query `api` TBD: may use `moduleRepository` + asset list; if no query exists, add `convex/moduleAssets.listForModule` or filter client-side from instance assets by module id prefix).

**Defer** full asset-by-module query if not in schema for v1 — document in plan checkpoint; channel-point redeem does not need it.

---

### Task 6: Schema-aware workflow JSON emission

**Files:**
- Modify: `client/src/lib/workflow-presets-json.ts`
- Modify: `client/src/lib/workflow-presets-json.test.ts`

- [ ] **Step 1: Add `sourceKind` helper**

```typescript
function isCommandsSource(field: ConfigField): boolean {
  return field.source?.kind === "commands";
}
function isInternalSource(field: ConfigField): boolean {
  return field.source?.kind === "internal";
}
```

- [ ] **Step 2: Replace `assembleEventType`**

Only consider fields where `source?.kind === "commands"`. Internal sources must not mutate the event.

- [ ] **Step 3: Implement `fieldValuesToConditions`**

```typescript
function fieldValuesToConditions(
  fields: ConfigField[],
  values: TriggerConfigValues,
): ConditionConfig[] {
  const out: ConditionConfig[] = [];
  for (const field of fields) {
    if (isCommandsSource(field)) {
      continue;
    }
    const raw = values[field.id];
    if (raw === null || raw === undefined || raw === "") {
      continue;
    }
    if (field.type === "range" && typeof raw === "object" && "type" in raw) {
      const cv = raw as ConfigValue;
      const path = field.eventPath ?? field.id;
      if (cv.type === "range" && cv.min !== undefined && cv.max !== undefined) {
        out.push({
          field: `\${trigger.data.${path}}`,
          operator: "between",
          value: [cv.min, cv.max],
        });
      } else if (cv.type === "single" && cv.value !== undefined) {
        out.push({
          field: `\${trigger.data.${path}}`,
          operator: field.operator ?? "eq",
          value: cv.value,
        });
      }
      continue;
    }
    const path = field.eventPath ?? field.id;
    out.push({
      field: `\${trigger.data.${path}}`,
      operator: field.operator ?? "eq",
      value: raw as unknown,
    });
  }
  return out;
}
```

Use in `configValuesToConditions` (delete ad-hoc loop) and per-variant branches.

- [ ] **Step 4: Tests**

Add cases:

```typescript
test("redeem trigger emits eq on rewardId, event unchanged", () => {
  const trigger = { /* redeem preset with internal source */ };
  const def = buildDefinitionFromPresets(trigger, chatAction, { rewardId: "abc" }, {});
  expect(def.trigger.event).toBe("redeem.channelpoints.twitch");
  expect(def.trigger.conditions).toEqual([
    { field: "${trigger.data.rewardId}", operator: "eq", value: "abc" },
  ]);
});

test("cheer amount emits gte on amount", () => {
  const trigger = { /* cheer fields id amount eventPath amount operator gte */ };
  const def = buildDefinitionFromPresets(trigger, chatAction, { amount: 100 }, {});
  expect(def.trigger.conditions).toEqual([
    { field: "${trigger.data.amount}", operator: "gte", value: 100 },
  ]);
});
```

- [ ] **Step 5: Run tests**

```bash
bun test client/src/lib/workflow-presets-json.test.ts
```

---

### Task 7: `allowVariants` — one workflow per variant (conditions on `trigger`)

**Files:**
- Modify: `client/src/lib/workflow-presets.ts`
- Modify: `client/src/lib/workflow-presets-json.ts`
- Modify: `client/src/components/workflows/basic-editor.tsx`
- Modify: `convex/seeds/triggerActions.ts` (remove `supportsTiers` seed shape or delete obsolete seeds)
- Modify: `client/src/pages/workflow-builder.tsx` (wire shared form when editing trigger/action nodes)

- [ ] **Step 1: Types — `TriggerVariant`, drop `supportsTiers`**

```typescript
export interface TriggerVariant {
  id: string;
  values: TriggerConfigValues;
  action: ActionPreset | null;
  actionConfig: TriggerConfigValues;
}

export interface TriggerPreset {
  // ...
  config?: TriggerConfig; // { fields, allowVariants? }
}
```

Remove `TierConfig` / `supportsTiers` / `tierLabel` from `workflow-presets.ts` and update all imports.

- [ ] **Step 2: `buildDefinitionForVariant` (single workflow)**

```typescript
export function buildDefinitionForVariant(
  trigger: TriggerWithEvent,
  variant: TriggerVariant,
  triggerCanonicalRef?: string,
): Omit<WorkflowDefinition, "id"> {
  if (!variant.action) {
    throw new Error("variant action is required");
  }
  const fields = trigger.config?.fields ?? [];
  return {
    name: `${trigger.name} → ${variant.action.name}`,
    description: trigger.description,
    trigger: {
      type: "event",
      event: assembleEventType(trigger, variant.values),
      conditions: fieldValuesToConditions(fields, variant.values),
      // populate $ref when catalog provides canonical trigger id
      ...(triggerCanonicalRef ? { $ref: triggerCanonicalRef } : {}),
    },
    tasks: [
      {
        id: "action-1",
        type: "action",
        action: variant.action.id,
        parameters: { ...variant.actionConfig },
      },
    ],
  };
}

export function buildDefinitionsForVariants(
  trigger: TriggerWithEvent,
  variants: TriggerVariant[],
  triggerCanonicalRef?: string,
): Omit<WorkflowDefinition, "id">[] {
  return variants
    .filter((v) => v.action)
    .map((v) => buildDefinitionForVariant(trigger, v, triggerCanonicalRef));
}
```

Delete `buildTieredDefinition` and any `amountToCondition` / per-variant `condition` tasks.

- [ ] **Step 3: Basic editor — gate on `allowVariants` only**

```typescript
const allowVariants = selectedTrigger?.config?.allowVariants === true;
```

Rename UI state `tiers` → `variants` (`TriggerVariant[]`). Keep the existing multi-card UX; each card still runs `TriggerConfigForm` over manifest `fields`.

- [ ] **Step 4: Save — batch create**

When `allowVariants` and user clicks Create:

```typescript
const defs = buildDefinitionsForVariants(selectedTrigger, variants, catalogTriggerRef);
for (const def of defs) {
  await createFromDefinition({ instanceId, definition: def });
}
```

Show toast: “Created N workflows”. Navigate to list (or first created id) — pick one UX and stick to it.

Non-variant path unchanged: `buildDefinitionFromPresets` with `fieldValuesToConditions` on the single `trigger`.

- [ ] **Step 5: Tests**

```typescript
test("two cheer variants produce two definitions with trigger conditions", () => {
  const defs = buildDefinitionsForVariants(cheerTrigger, [
    { id: "v1", values: { amount: 100 }, action: chatAction, actionConfig: { message: "a" } },
    { id: "v2", values: { amount: 500 }, action: chatAction, actionConfig: { message: "b" } },
  ]);
  expect(defs).toHaveLength(2);
  expect(defs[0].trigger.conditions).toEqual([
    { field: "${trigger.data.amount}", operator: "gte", value: 100 },
  ]);
  expect(defs[0].tasks).toHaveLength(1);
  expect(defs[0].tasks[0].type).toBe("action");
});
```

- [ ] **Step 6: React Flow builder**

Extract nothing new if panels can import `ConfigurationForm` + `parseConfigFields` from catalog row `configFields`. When a trigger node is selected, render the same field list; on save, use the same `buildDefinitionForVariant` / `buildDefinitionFromPresets` helpers as the basic editor.

---

### Task 8: Documentation + verification

**Files:**
- Modify: `docs/patterns/config-schema.md`
- Modify: `docs/ui/workflows.md` (short pointer)

- [ ] **Step 1: Update `config-schema.md`**

Document: `internal` vs `commands`, `allowVariants`, `eventPath`/`operator`, field metadata, `parseConfigFields` location.

- [ ] **Step 2: Full verification checklist**

```bash
bun run check
bunx biome check .
bun test client/src/lib/parse-config-fields.test.ts client/src/lib/workflow-presets-json.test.ts client/src/hooks/use-field-options.test.ts
```

Manual (requires dev stack):

1. Install `twitch_platform` on an instance with Twitch linked.
2. **Workflows → New → Channel point redemption**
   - Reward dropdown loads (internal API).
   - Info popover shows `dataSchema`.
3. Add second variant with different reward → create workflow.
4. Inspect saved definition: event `redeem.channelpoints.twitch`, per-variant `rewardId` conditions.
5. **Cheer** with `allowVariants`: two variants, different `minBits` → `gte` on `bits`.

---

## Sequencing

```text
Task 1 (types) → Task 2 (parse) → Task 3 (Convex ingest)
                              ↘
Task 4 (fieldOptions) → Task 5 (form) → Task 6 (JSON) → Task 7 (variants) → Task 8 (docs)
```

Tasks 4 and 3 can run in parallel after Task 2.

---

## Out of scope (follow-ups)

- React Flow visual builder (`workflow-builder.tsx`) — wire same `ConfigurationForm` / parsers when that editor gains manifest-driven step config.
- `resource_ref` / `asset` pickers scoped to owning module assets (partial Convex queries may be needed).
- Visual builder loading existing workflows back into preset forms (reverse projection).

---

## Risk notes

| Risk | Mitigation |
|------|------------|
| Twitch worker not running → empty internal options | Show empty state + hint from manifest; engine retries `no responders` |
| Duplicate parse logic client vs Convex | Keep algorithms identical; consider generating one from the other later |
| Convex `supportsTiers` column | Stop writing; optional DB cleanup later. Editor reads `allowVariants` only. |
| Cheer `minBits` vs `amount` | Update `twitch_platform` manifest cheer field id to `amount` to match wolfy_profile / user expectation |

---

## Spec coverage self-review

| Requirement | Task |
|-------------|------|
| `source.kind: internal` | 2, 4, 5 |
| `source.kind: commands` (fix semantics) | 6 |
| `eventPath` / `operator` | 2, 6 |
| `description` / `hint` / `dataSchema` | 5 |
| `allowVariants` (one workflow per variant, trigger conditions) | 3, 7 |
| Remove `supportsTiers` | 2, 7, seeds |
| React Flow shared form | 7 |
| Engine catalog source of truth | 3 |
| `media` → asset library | 5 |
| Bare-array `configSchema` | 3 |
| Manifest field types (`color`, `asset`, `resource_ref`, `boolean`) | 1, 2, 5 |
| Engine RPC + webhook path | 4 (already exists server-side) |
