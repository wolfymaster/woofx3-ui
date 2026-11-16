# Account portal

**Routes:** `/account` (Plan), `/account/payments`, `/account/people`, `/account/engines`
**Primary files:** `client/src/account-portal/`, `client/src/billing/`, `convex/organizations.ts`, `convex/billingCommands.ts`

The portal belongs to the signed-in person. Every signed-in user on the web build has an account page; the organization's content appears only for someone with a role in an organization. It is a route group inside the dashboard app, not a separate app. The shared components in `client/src/billing/` render both the organization's subscription and payments and, in the slots below, a person's own sponsorship.

## Where it runs

- On the dashboard origin, so it shares the dashboard's Convex Auth session (kept in `localStorage`, per origin). `woofx3.tv/account/*` is routed there by the edge.
- Outside `BroadcastShell` and `OnboardingGuard`, with its own slim layout (`AccountPortal.tsx`): it needs no engine, only a signed-in user. Someone signed out goes through sign-in and back to the same `/account/…` path (`AuthGuard`'s `?next=`, clamped by `safeNextPath`).
- The marketing site's "Start free trial" link opens `/account?start=trial`. Someone who owns no organization with an engine is sent straight on to onboarding, which starts the trial (`start-trial.ts`); an owner who already has an engine sees the Plan tab.
- **Web build only.** `App.tsx` imports it behind `IS_DESKTOP`, so the desktop build carries no `/account` route; `account-portal/boundary.test.ts` holds that.
- The routes are `ACCOUNT_PORTAL_ROUTE` in `App.tsx`. Nothing redirects from other paths; a link must name `/account` or one of the tabs.

## Data

- `organizations.mine({ now })` lists the caller's organizations, each with their role, a `can` map from `orgCan`, its engines, the subscription and seats. What a role may not see comes back empty: members get no subscription and no seats, and only the engines they're on. Only the owner gets the active discount.
- `organizations.members` (owner and admin) lists members with their engines. Email addresses are the owner's only, masked until shown, as on the Team page. Roles change and members are removed through `accountMembers.updateMemberRole` / `removeMember`. Invitations are sent from an engine's Team page, never here.
- `organizations.rename` (owner only). Engines are renamed with `instances.update`.
- Billing actions are the owner's (`manageBilling`) and live in `convex/billingCommands.ts`: `startCheckout`, `previewPromotionCode`, `openPortal`, `invoices` (answers null to anyone else) and `checkoutState` (where a checkout stands, for the page the customer returns to). Each asks the management plane through `convex/lib/billingClient.ts`, server-side and only for something a person just did; the plane reads invoices live and woofx3 stores none. The client authenticates with `MAINTENANCE_API_URL` / `MAINTENANCE_API_KEY`, whose key needs the `billing:read` and `billing:write` scopes. A checkout's `Idempotency-Key` derives from the org, the terms and a 30-minute window, so a retry or double click opens one checkout.
- A new org asks the plane to `ensure` its billing (`billingCommands.ensureBilling`, scheduled): a failure never blocks creating the org; Convex retries it with capped, jittered backoff for about a day, then logs an error, since the plane's reconciler may be off.
- Convex holds no payment code and no billing lifecycle. The management plane owns subscriptions, trials, exemptions, discounts and the provider's webhooks, and pushes each org's billing to Convex as a projection (`orgBilling`, one row per org, written by `POST /api/ops/accounts/:id/billing-projection`; see [Ops API](../patterns/ops-api.md)). `organizations.mine`, the access gates and the entitlements all read it through `billingFor` (`convex/lib/orgBilling.ts`) and never call the plane, so they keep working while it is down. An org with no projection row yet behaves as one with no subscription: nothing is refused, and its plan is its operator assignment or the default.
- The billing banner (`convex/billingBanner.ts`) is computed from the projection: the last week of a trial, and while a payment is overdue. Billing emails and their schedule belong to the plane; Convex sends none.

## Who sees what

`portal-pages.ts` maps each tab to the org action it needs (`visibleWith`; null means every signed-in user). A viewer with no organization sees the tabs that need no action. A tab the viewer cannot see sends them to `/account`.

| Viewer | Tabs |
|---|---|
| Org owner | Plan, Payments, People, Engines |
| Org admin | Plan, Payments, People, Engines |
| Org member | Plan, Payments, Engines |
| Signed in, no organization | Plan, Payments |

What a tab shows of the organization is gated by role, not by the tab being visible:

| Tab | Path | Organization part (owner only, `manageBilling`) | Everyone |
|---|---|---|---|
| Plan | `/account` | plan, state, discount; choose a plan and check out; manage billing | a "Your sponsorship" slot |
| Payments | `/account/payments` | the organization's invoice history | a "Your sponsor payments" slot |
| People | `/account/people` | (`manageMembers`) change roles, remove | |
| Engines | `/account/engines` | (`viewOrganization`) rename, open; members open the ones they're on | |

The portal does not use `viewBilling`: an admin sees no organization billing. The Plan header offers renaming the organization to the owner only (`renameOrganization`). Each slot is an empty state with a "Become a sponsor" link to `/sponsor/start` until sponsorships render there. The pages work with no organization at all: `organizations.mine` answers an empty list, the layout drops the organization switcher, and no organization query runs.

The Engines page lists the organization's engines and has no way to add one. An organization's first engine comes from onboarding.

Plan picks its content in `billing-view.ts`: an organization with only self-hosted engines reads "No subscription needed for self-hosted engines"; an exempt one shows its plan with no buttons; a running provider subscription offers "Manage billing" (the provider's portal); otherwise the owner chooses a plan and checks out. A checkout is refused while the provider subscription has not ended: one in good standing answers `already_subscribed`, and one whose payments are failing (past due, or suspended with the subscription still alive) answers `subscription_exists`, which sends the owner to the provider's portal to fix the payment method instead of paying for a second subscription. List prices in `@/billing/format.ts` must match the provider's prices and the marketing pricing page.

## Entry points

The profile menu's "Account" entry (any signed-in user, web build only) opens `/account`. The Team page has a "Manage organization" button for org owners and admins on a hosted engine, in the web build. Billing banners and in-app notices link to `/account`.
