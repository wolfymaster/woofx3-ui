# Debug Page — Trigger Simulation

**Status:** Design — pending implementation plan
**Date:** 2026-05-02
**Scope:** A new `/debug` page in woofx3-ui that lets the operator hand-fire canonical Twitch event triggers into a connected woofx3 engine instance. UI repo only — no engine changes.

## Problem

There is no in-product affordance for a developer or operator to fire a synthetic Twitch event (follow, subscription, gifted sub, cheer) at the engine. Today the only ways to exercise an event-triggered workflow are:

- Wait for a real Twitch event to arrive over EventSub.
- Run a one-off script against NATS directly.
- Call the engine's `simulateTwitchEvent(...)` RPC by hand from a REPL.

This blocks tight iteration on alert descriptors, workflow conditions, and module event handlers. We need a low-ceremony "press button → workflow fires" surface inside the UI itself.

## Goal

Add a "Debug" tab to the main nav. Its first (and for now only) section is **Triggers**, grouped by platform, with a "Twitch" sub-section containing four cards — Follow, Subscription, Subscription Gift, Cheer. Each card is a form pre-populated with sane defaults; submitting fires the canonical CloudEvent into the engine's NATS bus on the same subject the real Twitch handler uses, so any workflow listening for that event runs as if the event came from Twitch.

## Non-goals

- Visibility gating. Debug is always visible to any logged-in user; we are not building a dev-only flag, role gate, or admin guard. (Revisit if the surface grows beyond developer use.)
- Replay of historical events. This is a hand-fire UI, not a scrubber.
- Other platforms (Discord, YouTube). Structure must accommodate them but content is Twitch-only on day one.
- Other debug tooling (bus inspector, webhook payload generator). Out of scope; the page leaves room for future siblings.
- Engine changes. The existing `triggerEvent(eventType, eventData)` RPC already does what we need; we route through it. The engine's older `simulateTwitchEvent` helper (which publishes to a non-canonical `twitch.<event>` subject and so does **not** trigger workflow listeners) is unaffected by this work and remains as-is.

## Principles

1. **Canonical strings only.** The UI hard-codes the canonical CloudEvent type strings (`follow.user.twitch`, etc.), sourced from the shared `@woofx3/api` package's `TwitchEvent.EventType` enum so they cannot drift from the engine.
2. **Typed payloads at every layer.** Each form binds to a typed `TwitchEvent.Follow | Cheer | Subscribe | SubscriptionGift` shape. The Convex action's argument validator mirrors those shapes.
3. **Browser → Convex → engine.** Per CLAUDE.md, debug RPCs go through a Convex action over capnweb HTTP batch. `WoofxTransport` (the WS transport) is not used for one-shot calls.
4. **Extensible by structure, not abstraction.** Adding a new event later means adding one form component and one entry in a registry array, not building a generic form engine.
5. **No engine drift.** The Convex action is a thin pass-through. No mapping, no abbreviation, no enrichment.

## Architecture

```
client/src/pages/debug.tsx
        │
        │  useAction(api.debug.fireTrigger)
        ▼
convex/debug.ts :: fireTrigger (action)
        │
        │  createEngineRpcSession(...)
        │     .triggerEvent(canonicalType, payload)
        ▼
woofx3 engine ApiGateway → Api.triggerEvent(eventType, eventData)
        │
        │  publishEvent(eventType, eventData)  -- subject = eventType
        ▼
NATS (subject: follow.user.twitch | cheer.user.twitch | ...)
        │
        ▼
Workflow event registrar / module subscribers — fire as if real
```

No new tables. No new webhook handlers. No new shared SDK methods (the local-intersection pattern from `convex/lib/engineInstanceUrl.ts` covers the missing `triggerEvent` declaration).

## Components

### 1. Nav entry — `client/src/components/layout/broadcast-shell.tsx`

Append one item to `mainNavItems`:

```ts
{ id: 'debug', label: 'Debug', icon: Bug, href: '/debug' },
```

`Bug` from `lucide-react`. Always rendered — no conditional.

### 2. Route — `client/src/App.tsx`

Inside the existing protected `<BroadcastShell>` block, alongside the other routes:

```tsx
<Route path="/debug" component={Debug} />
```

Lazy-loading is not used elsewhere in this file, so we don't introduce it here.

### 3. Page — `client/src/pages/debug.tsx`

Single component. Layout:

```
<PageHeader title="Debug" description="Hand-fire events at the connected engine for testing." />

<section: Triggers>
  <h2: Triggers />
  <h3: Twitch />
  <grid (md:2 cols, sm:1 col)>
    <TriggerCard "Follow"            payload form />
    <TriggerCard "Subscription"      payload form />
    <TriggerCard "Subscription Gift" payload form />
    <TriggerCard "Cheer"             payload form />
  </grid>
</section>
```

Future platforms (Discord, etc.) become additional `<h3>` blocks with their own grids, all under the same `<section: Triggers>`. Future debug surfaces (bus inspector, etc.) become sibling `<section>` blocks on the same page.

### 4. Trigger card and form components — colocated under `client/src/components/debug/`

```
debug/
  trigger-card.tsx        — shared shadcn Card shell with title, description, footer Fire button
  twitch-follow-form.tsx
  twitch-cheer-form.tsx
  twitch-subscribe-form.tsx
  twitch-subscription-gift-form.tsx
  triggers-registry.ts    — array of { eventType, label, FormComponent } feeding the page
```

`triggers-registry.ts` is an array, not a map — order matters for rendering. Each entry pairs a canonical `EventType` enum value with its form component. The page renders the registry; adding a fifth Twitch trigger later is one entry, one form file.

Each form:

- Owns its local form state via `useState` (no Zod / react-hook-form — these are 1–5 fields each, not worth the dependency).
- Defines defaults inline so the card is immediately fireable without typing.
- On submit, calls a shared `useFireTrigger()` hook which wraps `useAction(api.debug.fireTrigger)` with a current-instance lookup and toast-on-result.

### 5. Convex action — `convex/debug.ts` (new file)

```ts
export const fireTrigger = action({
  args: {
    instanceId: v.id("instances"),
    eventType: v.string(),
    eventData: v.any(),
  },
  handler: async (ctx, { instanceId, eventType, eventData }) => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const rpc = createEngineRpcSession<DebugEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return rpc.triggerEvent(eventType, eventData as Record<string, unknown>);
  },
});

interface DebugEngineApi extends EngineApi {
  triggerEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<{ success: boolean; message: string }>;
}
```

`requireInstanceContext` is the same helper pattern already used in `convex/workflowActions.ts`. It enforces that the calling user owns the instance and that registration is complete.

`DebugEngineApi` is the local-intersection pattern documented in CLAUDE.md and applied in `BrowserTransport.BrowserEngineApi` (for `setEngineModuleState`). When `triggerEvent` lands in the shared `Woofx3EngineApi` contract, this intersection collapses to `EngineApi`.

The action does not validate `eventType` against an enum: the engine accepts arbitrary subject strings, and constraining it here would require maintaining a UI-side allowlist. Validation lives at the form layer (each form is hard-coded to one enum value).

### 6. Hook — `client/src/hooks/use-fire-trigger.ts` (new file)

```ts
export function useFireTrigger() {
  const { instance } = useInstance();
  const fire = useAction(api.debug.fireTrigger);
  const { toast } = useToast();

  return async function fireTrigger(eventType: string, eventData: Record<string, unknown>) {
    if (!instance) {
      toast({ variant: "destructive", title: "No instance selected" });
      return;
    }
    try {
      const result = await fire({ instanceId: instance._id, eventType, eventData });
      toast({
        title: "Event fired",
        description: `${eventType} → ${result.message}`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to fire event",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
```

## Data flow per event

| Form | Canonical subject (`EventType`) | Payload type (`@woofx3/api`'s `TwitchEvent.*`) |
|------|---------------------------------|------------------------------------------------|
| Follow            | `follow.user.twitch`        | `{ userName: string }` |
| Subscription      | `subscribe.user.twitch`     | `{ isGift: boolean; tier: string; userId: string \| null; userName: string \| null }` |
| Subscription Gift | `subscription.gift.twitch`  | `{ amount: number; gifterId: string; gifterName: string; isAnonymous: boolean; tier: string }` |
| Cheer             | `cheer.user.twitch`         | `{ amount: number; isAnonymous: boolean; message: string; userId: string \| null; userName: string \| null }` |

Form defaults (chosen so a single click produces a plausible event):

- **Follow:** `userName: "test_follower"`
- **Subscription:** `isGift: false, tier: "1000", userId: "12345", userName: "test_subscriber"`
- **Subscription Gift:** `amount: 5, gifterId: "12345", gifterName: "test_gifter", isAnonymous: false, tier: "1000"`
- **Cheer:** `amount: 100, isAnonymous: false, message: "Cheer100 nice stream!", userId: "12345", userName: "test_cheerer"`

Tier is presented as a `Select` with options `1000 / 2000 / 3000` (matching Twitch's tier strings). Booleans are `Switch` components. `userId` and `userName` are nullable in the SDK types for both Subscribe and Cheer. Cheer surfaces a dedicated "Anonymous" toggle (because `Cheer.isAnonymous` is part of the real payload) which nulls both fields when on. Subscribe has no `isAnonymous` field on the canonical event, so its `userId` / `userName` inputs stay as plain required text inputs — match the real Twitch handler, which always populates them.

## Error handling

- **No instance selected** — `useFireTrigger` short-circuits with a destructive toast.
- **Engine unreachable / auth fails** — capnweb throws inside the action, propagates as a thrown error from `useAction`, surfaced in the destructive toast.
- **Engine returns `{ success: false, message }`** — the success toast still renders but quotes `message`. (`triggerEvent` doesn't currently return failure shapes for the publish path, but we render whatever it returns to keep the action transparent.)
- **Form validation** — minimal. Numeric fields use `<Input type="number">` and clamp to non-negative. No cross-field rules. The engine and downstream consumers tolerate edge values; this is a debug surface.

## Testing

Manual end-to-end test plan, run by the implementer before merging:

1. Open `/debug`, fire a Follow with the default payload. Tail engine logs and confirm `Event published successfully` for subject `follow.user.twitch`. Confirm any installed workflow with a `follow.user.twitch` event trigger executes.
2. Repeat for Cheer, Subscription, Subscription Gift.
3. Toggle "Anonymous" on Cheer; confirm `userId` and `userName` arrive as `null` in the engine log.
4. With no instance selected (fresh account or signed out of all instances), confirm the destructive toast and no network call.
5. Stop the engine; fire a Follow; confirm the destructive toast surfaces a useful capnweb error message rather than hanging.

No automated tests for the page are added in this pass. The Convex action is thin enough that a unit test would be testing `triggerEvent` itself; we cover that through the manual E2E above.

## Future extensions (explicitly deferred)

- Recently-fired event log on the page (would require a Convex table or in-memory ring).
- "Save preset" affordance to remember non-default payloads.
- Discord / YouTube / Streamlabs trigger sections — slot into the existing `<section: Triggers>` grid.
- Bus inspector and webhook generator — siblings of the Triggers section.
- Role-based gating if the page becomes useful enough to non-developers that we want to restrict it.
