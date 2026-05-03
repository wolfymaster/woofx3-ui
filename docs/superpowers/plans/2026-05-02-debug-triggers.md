# Debug Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/debug` page to woofx3-ui with a Triggers section that hand-fires canonical Twitch events (Follow, Subscription, Subscription Gift, Cheer) at the connected engine via a thin Convex action.

**Architecture:** Browser form → Convex action `api.debug.fireTrigger` → engine `triggerEvent(canonicalSubject, payload)` over capnweb HTTP batch → engine `publishEvent` → NATS → workflow / module subscribers. No engine changes; the UI hard-codes canonical CloudEvent type strings (`follow.user.twitch`, `cheer.user.twitch`, `subscribe.user.twitch`, `subscription.gift.twitch`) and payload shapes mirrored from `~/code/wolfymaster/woofx3/shared/common/typescript/cloudevents/Twitch/events.ts`.

**Tech Stack:** React 18, Wouter (routing), Convex (backend + auth), capnweb (engine RPC), shadcn/ui (Card, Button, Input, Switch, Select, Label), `lucide-react` icons, `bun:test` for unit tests, Biome for lint/format.

**Spec:** `docs/superpowers/specs/2026-05-02-debug-triggers-design.md`

---

## File Map

**Create:**
- `client/src/lib/debug/twitch-events.ts` — canonical subjects + payload types (mirrored from cloudevents source).
- `client/src/lib/debug/twitch-events.test.ts` — sanity test pinning the four canonical strings.
- `client/src/components/debug/trigger-card.tsx` — shared Card shell (title + description + form slot + Fire button).
- `client/src/components/debug/twitch-follow-form.tsx`
- `client/src/components/debug/twitch-cheer-form.tsx`
- `client/src/components/debug/twitch-subscribe-form.tsx`
- `client/src/components/debug/twitch-subscription-gift-form.tsx`
- `client/src/components/debug/triggers-registry.ts` — array binding event types to form components.
- `client/src/hooks/use-fire-trigger.ts` — wraps `useAction(api.debug.fireTrigger)` with current-instance + toast.
- `client/src/pages/debug.tsx` — page component.
- `convex/debug.ts` — `fireTrigger` action.

**Modify:**
- `client/src/components/layout/broadcast-shell.tsx:68` — add Debug nav item.
- `client/src/App.tsx` — add Debug route + import.

**Reference (do not modify):**
- `convex/chatCommands.ts:12-49` — `requireInstanceContext` pattern to copy.
- `convex/lib/engineInstanceUrl.ts` — `EngineApi`, `createEngineRpcSession` exports.
- `~/code/wolfymaster/woofx3/shared/common/typescript/cloudevents/Twitch/events.ts` — canonical event shapes (source of truth for the local mirror).
- `~/code/wolfymaster/woofx3/api/src/api.ts:1660` — engine `triggerEvent` implementation.

---

## Task 1: Local Twitch event types and canonical subjects

**Files:**
- Create: `client/src/lib/debug/twitch-events.ts`
- Test:   `client/src/lib/debug/twitch-events.test.ts`

This module is the UI-side source of truth for the four canonical CloudEvent type strings and payload shapes. It mirrors `~/code/wolfymaster/woofx3/shared/common/typescript/cloudevents/Twitch/events.ts`. We mirror (rather than import the shared file directly) because the SDK package `@woofx3/api` does not currently re-export the cloudevents subpath, and dragging the cloudevents tree into the vite alias is more change than this debug feature warrants.

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/debug/twitch-events.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { TWITCH_EVENT_SUBJECTS } from "./twitch-events";

describe("TWITCH_EVENT_SUBJECTS", () => {
  test("matches the canonical CloudEvent type strings used by the engine", () => {
    expect(TWITCH_EVENT_SUBJECTS).toEqual({
      follow: "follow.user.twitch",
      cheer: "cheer.user.twitch",
      subscribe: "subscribe.user.twitch",
      subscriptionGift: "subscription.gift.twitch",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test client/src/lib/debug/twitch-events.test.ts`
Expected: FAIL with module-not-found error for `./twitch-events`.

- [ ] **Step 3: Create the implementation**

Create `client/src/lib/debug/twitch-events.ts`:

```ts
// Canonical Twitch CloudEvent type strings + payload shapes.
//
// Mirrored from the engine source of truth at
//   ~/code/wolfymaster/woofx3/shared/common/typescript/cloudevents/Twitch/events.ts
// (the engine's `EventType` enum + per-event interfaces). Kept in sync by the
// pin test in twitch-events.test.ts. If any of these strings change in the
// engine, that test fails — update both sides together.
//
// We mirror rather than import because @woofx3/api does not re-export the
// cloudevents subpath today; pulling that subpath into the vite alias is a
// larger surface change than this debug page warrants.

export const TWITCH_EVENT_SUBJECTS = {
  follow: "follow.user.twitch",
  cheer: "cheer.user.twitch",
  subscribe: "subscribe.user.twitch",
  subscriptionGift: "subscription.gift.twitch",
} as const;

export type TwitchEventKey = keyof typeof TWITCH_EVENT_SUBJECTS;

export interface TwitchFollowPayload {
  userName: string;
}

export interface TwitchCheerPayload {
  amount: number;
  isAnonymous: boolean;
  message: string;
  userId: string | null;
  userName: string | null;
}

export interface TwitchSubscribePayload {
  isGift: boolean;
  tier: string;
  userId: string | null;
  userName: string | null;
}

export interface TwitchSubscriptionGiftPayload {
  amount: number;
  gifterId: string;
  gifterName: string;
  isAnonymous: boolean;
  tier: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test client/src/lib/debug/twitch-events.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/debug/twitch-events.ts client/src/lib/debug/twitch-events.test.ts
git commit -m "feat(debug): add canonical Twitch event subjects and payload types"
```

---

## Task 2: Convex action `debug.fireTrigger`

**Files:**
- Create: `convex/debug.ts`

This is a thin pass-through to the engine's existing `triggerEvent(eventType, eventData)` over capnweb HTTP batch. We follow the existing per-file `requireInstanceContext` pattern from `convex/chatCommands.ts:28` rather than extracting a shared helper (matches established convention; out of scope to refactor).

`triggerEvent` is not declared on the shared `Woofx3EngineApi` interface, so we use the local-intersection pattern from `convex/lib/engineInstanceUrl.ts` (same shape used by `BrowserTransport.BrowserEngineApi`).

- [ ] **Step 1: Create the action file**

Create `convex/debug.ts`:

```ts
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

type InstanceContext = {
  url: string;
  applicationId: string;
  clientId: string;
  clientSecret: string;
};

// Local intersection: triggerEvent is implemented on the engine's Api class
// but not yet declared on the shared Woofx3EngineApi interface. Retire this
// extension when the shared SDK catches up.
interface DebugEngineApi extends EngineApi {
  triggerEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<{ success: boolean; message: string }>;
}

async function requireInstanceContext(ctx: ActionCtx, instanceId: Id<"instances">): Promise<InstanceContext> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
    instanceId,
    userId,
  });
  if (!bundle) {
    throw new Error("Not authorized, instance not found, or instance is not registered with the engine");
  }
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return {
    url: bundle.url,
    applicationId: bundle.applicationId,
    clientId: bundle.clientId,
    clientSecret: bundle.clientSecret,
  };
}

/**
 * Hand-fire an event into the engine's NATS bus on a caller-supplied subject.
 * Used by the /debug page to simulate Twitch (and future) triggers without
 * needing real platform traffic. Caller is responsible for using a canonical
 * subject string — this is intentional, see docs/superpowers/specs/
 * 2026-05-02-debug-triggers-design.md.
 */
export const fireTrigger = action({
  args: {
    instanceId: v.id("instances"),
    eventType: v.string(),
    eventData: v.any(),
  },
  handler: async (ctx, { instanceId, eventType, eventData }): Promise<{ success: boolean; message: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const rpc = createEngineRpcSession<DebugEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return rpc.triggerEvent(eventType, eventData as Record<string, unknown>);
  },
});
```

- [ ] **Step 2: Verify Convex codegen and types**

Run: `bunx convex dev --once` (in another terminal if `bunx convex dev` is not already running, this regenerates `convex/_generated/api.d.ts`).
Then run: `bun run check`
Expected: 0 type errors. `api.debug.fireTrigger` should now exist on the generated API.

If `bunx convex dev` is already running it will regenerate automatically; just wait a couple seconds and run `bun run check`.

- [ ] **Step 3: Commit**

```bash
git add convex/debug.ts convex/_generated/api.d.ts convex/_generated/api.js
git commit -m "feat(convex): add debug.fireTrigger action proxying to engine triggerEvent"
```

(If `convex/_generated/*` files were not modified by codegen, just commit `convex/debug.ts`.)

---

## Task 3: `useFireTrigger` hook

**Files:**
- Create: `client/src/hooks/use-fire-trigger.ts`

Wraps `useAction(api.debug.fireTrigger)` with the current-instance lookup and a toast on success/failure. Returns a stable callback that forms can invoke.

- [ ] **Step 1: Create the hook**

Create `client/src/hooks/use-fire-trigger.ts`:

```ts
import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";

/**
 * Returns a callback that fires a synthetic event at the currently selected
 * woofx3 instance. Surfaces the engine's response (or any error) as a toast.
 * Used by the /debug page trigger forms.
 */
export function useFireTrigger() {
  const { instance } = useInstance();
  const fire = useAction(api.debug.fireTrigger);
  const { toast } = useToast();

  return async function fireTrigger(eventType: string, eventData: Record<string, unknown>): Promise<void> {
    if (!instance) {
      toast({
        variant: "destructive",
        title: "No instance selected",
        description: "Pick an instance from the workspace switcher before firing test events.",
      });
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

- [ ] **Step 2: Verify types**

Run: `bun run check`
Expected: 0 errors. The hook closes over `instance._id` (typed `Id<"instances">`) which matches the action's `v.id("instances")` validator.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/use-fire-trigger.ts
git commit -m "feat(debug): add useFireTrigger hook"
```

---

## Task 4: `TriggerCard` shared shell

**Files:**
- Create: `client/src/components/debug/trigger-card.tsx`

A reusable Card with title, description, body slot for the form fields, and a Fire button in the footer. Each form passes its own onSubmit which the card's button invokes; the card owns the busy state so each form doesn't reimplement it.

- [ ] **Step 1: Create the component**

Create `client/src/components/debug/trigger-card.tsx`:

```tsx
import type { ReactNode } from "react";
import { useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface TriggerCardProps {
  title: string;
  description: string;
  // canonical CloudEvent subject — surfaced under the title for clarity
  eventSubject: string;
  // Form fields rendered in the card body
  children: ReactNode;
  // Caller fires the event. Card manages the in-flight state.
  onFire: () => Promise<void>;
}

export function TriggerCard({ title, description, eventSubject, children, onFire }: TriggerCardProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await onFire();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid={`trigger-card-${eventSubject}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description}
          <span className="block mt-1 font-mono text-xs text-muted-foreground/80">{eventSubject}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
      <CardFooter>
        <Button onClick={handleClick} disabled={busy} className="gap-2">
          <Zap className="h-4 w-4" />
          {busy ? "Firing..." : "Fire"}
        </Button>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/debug/trigger-card.tsx
git commit -m "feat(debug): add TriggerCard shared shell"
```

---

## Task 5: Twitch Follow form

**Files:**
- Create: `client/src/components/debug/twitch-follow-form.tsx`

Single field (`userName`). Demonstrates the form pattern that the next three forms repeat.

- [ ] **Step 1: Create the form**

Create `client/src/components/debug/twitch-follow-form.tsx`:

```tsx
import { useState } from "react";
import { TriggerCard } from "@/components/debug/trigger-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFireTrigger } from "@/hooks/use-fire-trigger";
import { TWITCH_EVENT_SUBJECTS, type TwitchFollowPayload } from "@/lib/debug/twitch-events";

const DEFAULTS: TwitchFollowPayload = {
  userName: "test_follower",
};

export function TwitchFollowForm() {
  const fire = useFireTrigger();
  const [payload, setPayload] = useState<TwitchFollowPayload>(DEFAULTS);

  return (
    <TriggerCard
      title="Follow"
      description="Simulate a new channel follow."
      eventSubject={TWITCH_EVENT_SUBJECTS.follow}
      onFire={() => fire(TWITCH_EVENT_SUBJECTS.follow, payload as unknown as Record<string, unknown>)}
    >
      <div className="space-y-2">
        <Label htmlFor="follow-userName">User name</Label>
        <Input
          id="follow-userName"
          value={payload.userName}
          onChange={(e) => setPayload({ ...payload, userName: e.target.value })}
          data-testid="input-follow-userName"
        />
      </div>
    </TriggerCard>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/debug/twitch-follow-form.tsx
git commit -m "feat(debug): add Twitch Follow trigger form"
```

---

## Task 6: Twitch Cheer form

**Files:**
- Create: `client/src/components/debug/twitch-cheer-form.tsx`

Has the `isAnonymous` toggle. When on, `userId` and `userName` are sent as `null` (matches real Twitch handler behavior) and the corresponding inputs are disabled.

- [ ] **Step 1: Create the form**

Create `client/src/components/debug/twitch-cheer-form.tsx`:

```tsx
import { useState } from "react";
import { TriggerCard } from "@/components/debug/trigger-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFireTrigger } from "@/hooks/use-fire-trigger";
import { TWITCH_EVENT_SUBJECTS, type TwitchCheerPayload } from "@/lib/debug/twitch-events";

interface FormState {
  amount: number;
  message: string;
  userId: string;
  userName: string;
  isAnonymous: boolean;
}

const DEFAULTS: FormState = {
  amount: 100,
  message: "Cheer100 nice stream!",
  userId: "12345",
  userName: "test_cheerer",
  isAnonymous: false,
};

function toPayload(state: FormState): TwitchCheerPayload {
  return {
    amount: state.amount,
    isAnonymous: state.isAnonymous,
    message: state.message,
    userId: state.isAnonymous ? null : state.userId,
    userName: state.isAnonymous ? null : state.userName,
  };
}

export function TwitchCheerForm() {
  const fire = useFireTrigger();
  const [state, setState] = useState<FormState>(DEFAULTS);

  return (
    <TriggerCard
      title="Cheer"
      description="Simulate a bits cheer."
      eventSubject={TWITCH_EVENT_SUBJECTS.cheer}
      onFire={() => fire(TWITCH_EVENT_SUBJECTS.cheer, toPayload(state) as unknown as Record<string, unknown>)}
    >
      <div className="space-y-2">
        <Label htmlFor="cheer-amount">Bits</Label>
        <Input
          id="cheer-amount"
          type="number"
          min={0}
          value={state.amount}
          onChange={(e) => setState({ ...state, amount: Math.max(0, Number(e.target.value) || 0) })}
          data-testid="input-cheer-amount"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cheer-message">Message</Label>
        <Input
          id="cheer-message"
          value={state.message}
          onChange={(e) => setState({ ...state, message: e.target.value })}
          data-testid="input-cheer-message"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="cheer-anon">Anonymous</Label>
        <Switch
          id="cheer-anon"
          checked={state.isAnonymous}
          onCheckedChange={(checked) => setState({ ...state, isAnonymous: checked })}
          data-testid="switch-cheer-anon"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cheer-userId">User ID</Label>
        <Input
          id="cheer-userId"
          value={state.userId}
          disabled={state.isAnonymous}
          onChange={(e) => setState({ ...state, userId: e.target.value })}
          data-testid="input-cheer-userId"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cheer-userName">User name</Label>
        <Input
          id="cheer-userName"
          value={state.userName}
          disabled={state.isAnonymous}
          onChange={(e) => setState({ ...state, userName: e.target.value })}
          data-testid="input-cheer-userName"
        />
      </div>
    </TriggerCard>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/debug/twitch-cheer-form.tsx
git commit -m "feat(debug): add Twitch Cheer trigger form"
```

---

## Task 7: Twitch Subscribe form

**Files:**
- Create: `client/src/components/debug/twitch-subscribe-form.tsx`

Tier select (`1000` / `2000` / `3000`), `isGift` toggle, plain text inputs for `userId` / `userName` (no `isAnonymous` field on the canonical event — matches real handler).

- [ ] **Step 1: Create the form**

Create `client/src/components/debug/twitch-subscribe-form.tsx`:

```tsx
import { useState } from "react";
import { TriggerCard } from "@/components/debug/trigger-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFireTrigger } from "@/hooks/use-fire-trigger";
import { TWITCH_EVENT_SUBJECTS, type TwitchSubscribePayload } from "@/lib/debug/twitch-events";

const DEFAULTS: TwitchSubscribePayload = {
  isGift: false,
  tier: "1000",
  userId: "12345",
  userName: "test_subscriber",
};

export function TwitchSubscribeForm() {
  const fire = useFireTrigger();
  const [payload, setPayload] = useState<TwitchSubscribePayload>(DEFAULTS);

  return (
    <TriggerCard
      title="Subscription"
      description="Simulate a channel subscription."
      eventSubject={TWITCH_EVENT_SUBJECTS.subscribe}
      onFire={() => fire(TWITCH_EVENT_SUBJECTS.subscribe, payload as unknown as Record<string, unknown>)}
    >
      <div className="space-y-2">
        <Label htmlFor="sub-tier">Tier</Label>
        <Select value={payload.tier} onValueChange={(value) => setPayload({ ...payload, tier: value })}>
          <SelectTrigger id="sub-tier" data-testid="select-sub-tier">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1000">Tier 1 (1000)</SelectItem>
            <SelectItem value="2000">Tier 2 (2000)</SelectItem>
            <SelectItem value="3000">Tier 3 (3000)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="sub-isGift">Gift</Label>
        <Switch
          id="sub-isGift"
          checked={payload.isGift}
          onCheckedChange={(checked) => setPayload({ ...payload, isGift: checked })}
          data-testid="switch-sub-isGift"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sub-userId">User ID</Label>
        <Input
          id="sub-userId"
          value={payload.userId ?? ""}
          onChange={(e) => setPayload({ ...payload, userId: e.target.value })}
          data-testid="input-sub-userId"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sub-userName">User name</Label>
        <Input
          id="sub-userName"
          value={payload.userName ?? ""}
          onChange={(e) => setPayload({ ...payload, userName: e.target.value })}
          data-testid="input-sub-userName"
        />
      </div>
    </TriggerCard>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/debug/twitch-subscribe-form.tsx
git commit -m "feat(debug): add Twitch Subscribe trigger form"
```

---

## Task 8: Twitch Subscription Gift form

**Files:**
- Create: `client/src/components/debug/twitch-subscription-gift-form.tsx`

Has `isAnonymous` toggle, but unlike Cheer it does NOT null `gifterId` / `gifterName` — the canonical `SubscriptionGift` payload keeps both fields populated alongside `isAnonymous: true` (matches real Twitch behavior — the gift event always names the gifter even when anonymous to viewers). `amount` is the count of gifted subs.

- [ ] **Step 1: Create the form**

Create `client/src/components/debug/twitch-subscription-gift-form.tsx`:

```tsx
import { useState } from "react";
import { TriggerCard } from "@/components/debug/trigger-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFireTrigger } from "@/hooks/use-fire-trigger";
import { TWITCH_EVENT_SUBJECTS, type TwitchSubscriptionGiftPayload } from "@/lib/debug/twitch-events";

const DEFAULTS: TwitchSubscriptionGiftPayload = {
  amount: 5,
  gifterId: "12345",
  gifterName: "test_gifter",
  isAnonymous: false,
  tier: "1000",
};

export function TwitchSubscriptionGiftForm() {
  const fire = useFireTrigger();
  const [payload, setPayload] = useState<TwitchSubscriptionGiftPayload>(DEFAULTS);

  return (
    <TriggerCard
      title="Subscription Gift"
      description="Simulate a bulk-gifted-subs event."
      eventSubject={TWITCH_EVENT_SUBJECTS.subscriptionGift}
      onFire={() =>
        fire(TWITCH_EVENT_SUBJECTS.subscriptionGift, payload as unknown as Record<string, unknown>)
      }
    >
      <div className="space-y-2">
        <Label htmlFor="gift-amount">Subs gifted</Label>
        <Input
          id="gift-amount"
          type="number"
          min={1}
          value={payload.amount}
          onChange={(e) => setPayload({ ...payload, amount: Math.max(1, Number(e.target.value) || 1) })}
          data-testid="input-gift-amount"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gift-tier">Tier</Label>
        <Select value={payload.tier} onValueChange={(value) => setPayload({ ...payload, tier: value })}>
          <SelectTrigger id="gift-tier" data-testid="select-gift-tier">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1000">Tier 1 (1000)</SelectItem>
            <SelectItem value="2000">Tier 2 (2000)</SelectItem>
            <SelectItem value="3000">Tier 3 (3000)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="gift-gifterId">Gifter ID</Label>
        <Input
          id="gift-gifterId"
          value={payload.gifterId}
          onChange={(e) => setPayload({ ...payload, gifterId: e.target.value })}
          data-testid="input-gift-gifterId"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gift-gifterName">Gifter name</Label>
        <Input
          id="gift-gifterName"
          value={payload.gifterName}
          onChange={(e) => setPayload({ ...payload, gifterName: e.target.value })}
          data-testid="input-gift-gifterName"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="gift-isAnonymous">Anonymous</Label>
        <Switch
          id="gift-isAnonymous"
          checked={payload.isAnonymous}
          onCheckedChange={(checked) => setPayload({ ...payload, isAnonymous: checked })}
          data-testid="switch-gift-isAnonymous"
        />
      </div>
    </TriggerCard>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/debug/twitch-subscription-gift-form.tsx
git commit -m "feat(debug): add Twitch Subscription Gift trigger form"
```

---

## Task 9: Triggers registry

**Files:**
- Create: `client/src/components/debug/triggers-registry.ts`

An array (order matters — that's the render order) grouping the four Twitch forms under a "Twitch" platform heading. Future platforms append a new group entry; future Twitch events append a new form entry inside the existing group.

- [ ] **Step 1: Create the registry**

Create `client/src/components/debug/triggers-registry.ts`:

```ts
import type { ComponentType } from "react";
import { TwitchCheerForm } from "@/components/debug/twitch-cheer-form";
import { TwitchFollowForm } from "@/components/debug/twitch-follow-form";
import { TwitchSubscribeForm } from "@/components/debug/twitch-subscribe-form";
import { TwitchSubscriptionGiftForm } from "@/components/debug/twitch-subscription-gift-form";

export interface TriggerEntry {
  // Stable key for React lists. Use the canonical event subject.
  key: string;
  Form: ComponentType;
}

export interface TriggerGroup {
  // Display heading for the group (e.g. "Twitch").
  heading: string;
  // Stable key for React lists.
  key: string;
  entries: TriggerEntry[];
}

// Order is meaningful — these render in the listed sequence.
export const TRIGGER_GROUPS: TriggerGroup[] = [
  {
    heading: "Twitch",
    key: "twitch",
    entries: [
      { key: "follow.user.twitch", Form: TwitchFollowForm },
      { key: "subscribe.user.twitch", Form: TwitchSubscribeForm },
      { key: "subscription.gift.twitch", Form: TwitchSubscriptionGiftForm },
      { key: "cheer.user.twitch", Form: TwitchCheerForm },
    ],
  },
];
```

- [ ] **Step 2: Verify types**

Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/debug/triggers-registry.ts
git commit -m "feat(debug): add triggers registry binding event keys to forms"
```

---

## Task 10: `/debug` page

**Files:**
- Create: `client/src/pages/debug.tsx`

Renders the page header, a "Triggers" section, and walks `TRIGGER_GROUPS` rendering each group's heading + grid of its forms.

- [ ] **Step 1: Create the page**

Create `client/src/pages/debug.tsx`:

```tsx
import { TRIGGER_GROUPS } from "@/components/debug/triggers-registry";
import { PageHeader } from "@/components/layout/page-header";

export default function Debug() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="Debug"
        description="Hand-fire events at the connected engine for testing."
      />

      <section className="space-y-6">
        <h2 className="text-lg font-semibold tracking-tight">Triggers</h2>

        {TRIGGER_GROUPS.map((group) => (
          <div key={group.key} className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {group.heading}
            </h3>
            <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
              {group.entries.map(({ key, Form }) => (
                <Form key={key} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/debug.tsx
git commit -m "feat(debug): add /debug page rendering trigger groups"
```

---

## Task 11: Wire route + nav entry

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/layout/broadcast-shell.tsx`

- [ ] **Step 1: Add the import to App.tsx**

In `client/src/App.tsx`, locate the import block (lines 13–34) where pages are imported alphabetically. Add the Debug import in alphabetical order (after `Commands` and before `Dashboard`):

Add this line after the `Commands` import (currently line 21):

```tsx
import Debug from "@/pages/debug";
```

The result around lines 21–22:

```tsx
import Commands from "@/pages/commands";
import Dashboard from "@/pages/dashboard";
import Debug from "@/pages/debug";
```

(Alphabetical: Commands → Dashboard → Debug.)

- [ ] **Step 2: Add the route to App.tsx**

In `client/src/App.tsx` add the Debug route inside the protected `<Switch>` block. Locate the line containing `<Route path="/commands" component={Commands} />` (currently line 137) and add a new Route after it:

```tsx
<Route path="/commands" component={Commands} />
<Route path="/debug" component={Debug} />
<Route path="/team" component={Team} />
```

- [ ] **Step 3: Add Bug to the lucide-react import in broadcast-shell.tsx**

In `client/src/components/layout/broadcast-shell.tsx`, find the `lucide-react` import block. Add `Bug` to the imports in alphabetical order. The existing block currently brings in icons including `Bell`, `LayoutDashboard`, `Puzzle`, etc. Locate the `import { ... } from 'lucide-react';` line and add `Bug` after `Bell` in the alphabetized list.

To find the exact line:

```bash
grep -n "from 'lucide-react'" client/src/components/layout/broadcast-shell.tsx
```

Then add `Bug,` to the alphabetized destructured list.

- [ ] **Step 4: Add the Debug nav item**

In `client/src/components/layout/broadcast-shell.tsx:68`, the `mainNavItems` array currently ends with the Commands entry. Append the Debug entry as the last item:

Before:

```ts
const mainNavItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { id: 'modules', label: 'Modules', icon: Puzzle, href: '/modules' },
  { id: 'workflows', label: 'Workflows', icon: Workflow, href: '/workflows' },
  { id: 'assets', label: 'Assets', icon: FolderOpen, href: '/assets' },
  { id: 'scenes', label: 'Scenes', icon: Layers, href: '/scenes' },
  { id: 'alerts', label: 'Alert Log', icon: Bell, href: '/alerts' },
  { id: 'commands', label: 'Commands', icon: MessageSquare, href: '/commands' },
];
```

After:

```ts
const mainNavItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { id: 'modules', label: 'Modules', icon: Puzzle, href: '/modules' },
  { id: 'workflows', label: 'Workflows', icon: Workflow, href: '/workflows' },
  { id: 'assets', label: 'Assets', icon: FolderOpen, href: '/assets' },
  { id: 'scenes', label: 'Scenes', icon: Layers, href: '/scenes' },
  { id: 'alerts', label: 'Alert Log', icon: Bell, href: '/alerts' },
  { id: 'commands', label: 'Commands', icon: MessageSquare, href: '/commands' },
  { id: 'debug', label: 'Debug', icon: Bug, href: '/debug' },
];
```

- [ ] **Step 5: Verify types and lint**

Run: `bun run check && bunx biome check .`
Expected: 0 type errors, 0 lint errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/components/layout/broadcast-shell.tsx
git commit -m "feat(debug): wire /debug route and nav entry"
```

---

## Task 12: Manual end-to-end verification

**Files:** none (verification only).

Spec calls for manual E2E. This task does not produce code; it ensures the feature works against a running engine.

- [ ] **Step 1: Start the stack**

In separate terminals:

```bash
# Terminal A
bunx convex dev

# Terminal B
bun run dev
```

Plus your woofx3 engine running locally on its registered URL.

- [ ] **Step 2: Confirm nav and page render**

- Sign in to the UI.
- Confirm the **Debug** tab renders in the WorkspaceDock with the Bug icon.
- Click it. URL becomes `/debug`. Page header reads "Debug". A "Triggers" section is visible. Under it, a "Twitch" sub-heading with four cards: Follow, Subscription, Subscription Gift, Cheer.

- [ ] **Step 3: Fire each event and confirm engine receipt**

In a terminal tailing engine logs, fire each card with default values:

- **Follow** → expect engine log: `Event published successfully` for subject `follow.user.twitch`. If you have a workflow with a `follow.user.twitch` event trigger, it should execute.
- **Cheer** → subject `cheer.user.twitch`.
- **Subscription** → subject `subscribe.user.twitch`.
- **Subscription Gift** → subject `subscription.gift.twitch`.

Each fire should surface a green toast: `Event fired — <subject> → Published event: <subject>`.

- [ ] **Step 4: Test the anonymous toggle on Cheer**

- Toggle "Anonymous" on the Cheer card. Confirm the User ID and User name inputs become disabled.
- Fire. In the engine log, the published `data` payload should show `userId: null, userName: null`. Toggle off, fire again, confirm the values return.

- [ ] **Step 5: Test the no-instance edge**

If you have multiple instances, switch to one that isn't registered with the engine yet, or sign in as a fresh account. Click Fire on any card. Expect the destructive toast: "Failed to fire event — Instance is not registered with the engine" (or "Not authorized..." if no instance at all).

- [ ] **Step 6: Test the engine-down edge**

Stop the engine. Click Fire on any card. Expect a destructive toast within the capnweb timeout containing a connection-refused-style error message. UI should not hang.

- [ ] **Step 7: No commit**

This task produces no code changes. If any step failed, return to the relevant earlier task to fix and recommit.
