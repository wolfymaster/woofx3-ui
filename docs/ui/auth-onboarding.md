# Auth and onboarding

**Routes:** `/auth/login`, `/auth/register`, `/auth/onboarding`  
**Primary files:** `client/src/pages/auth/login.tsx`, `register.tsx`, `onboarding.tsx`  
**Backend:** `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts` (Twitch OAuth), `convex/twitchAuth.ts`, `convex/accounts.ts`, `convex/instances.ts`

## Login and registration

- **Convex Auth** provides session handling; Twitch OAuth is initiated through **Convex HTTP routes** (e.g. `/api/auth/twitch/start` → Twitch → callback) that validate state and complete sign-in.
- Password provider routes are registered via `auth.addHttpRoutes` in `http.ts`.

## Onboarding

- **Guard:** only authenticated users reach `/auth/onboarding` (wrapped in `AuthGuard` in `App.tsx`).
- **Step 1 — Account:** creates an **account** via `accounts.createAccount` if the user does not already have one (`getMyAccount`).
- **Step 2 — Instance:** creates an **instance** with display name and engine **URL**, then registers it with the engine (`registration.registerInstance`); then sets **`$currentInstanceId`** and navigates home.

> **Note:** The full **registration handshake** (engine stores the callback URL and token; Convex receives the client credentials) is described in `CLAUDE.md`.

## After onboarding

`OnboardingGuard` requires both an account and at least one instance before showing `BroadcastShell`.
