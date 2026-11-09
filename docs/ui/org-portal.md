# Organization portal

**Routes:** `/org`, `/org/billing`, `/org/members`, `/org/engines`, `/org/invoices`
**Primary files:** `client/src/org-portal/`, `convex/organizations.ts`, `convex/billing.ts`

The portal is where an organization's owner and admins manage the organization and its billing. It is a route group inside the dashboard app, not a separate app.

## Where it runs

- On the dashboard origin, so it shares the dashboard's Convex Auth session (kept in `localStorage`, per origin). `woofx3.tv/org/*` is redirected there by the edge.
- Outside `BroadcastShell` and `OnboardingGuard`, with its own slim layout (`OrgPortal.tsx`): it needs no engine, only a signed-in user. Someone signed out goes through sign-in and back to the same `/org/…` path (`AuthGuard`'s `?next=`, clamped by `safeNextPath`).
- The marketing site's "Start free trial" link opens `/org/?start=trial`. Someone who owns no organization with an engine is sent straight on to onboarding, which starts the trial (`start-trial.ts`); an owner who already has an engine sees the overview.
- **Web build only.** `App.tsx` imports it behind `IS_DESKTOP`, so the desktop build carries no `/org` route; `org-portal/boundary.test.ts` holds that.

## Data

- `organizations.mine({ now })` lists the caller's organizations, each with their role, a `can` map from `orgCan`, its engines, the subscription and seats. What a role may not see comes back empty: members get no subscription and no seats, and only the engines they're on. Only the owner gets the active discount.
- `organizations.members` (owner and admin) lists members with their engines. Email addresses are the owner's only, masked until shown, as on the Team page. Roles change and members are removed through `accountMembers.updateMemberRole` / `removeMember`. Invitations are sent from an engine's Team page, never here.
- `organizations.rename` (owner and admin). Engines are renamed with `instances.update`.
- Billing actions are the owner's (`manageBilling`): `billing.startCheckout`, `billing.previewPromotionCode`, `billing.openPortal`, and `billing.invoices`, which reads the customer's invoices live through `PaymentProvider.listInvoices` and answers null to anyone else. woofx3 stores no invoices.
- Money moves through the payments module (`convex/lib/payments/`), behind `PaymentProvider`. The provider's webhooks arrive at `POST /payments/stripe/webhook` (`convex/paymentsHttp.ts`) and are kept as received in `paymentEvents`. Its configuration is `PAYMENTS_PROVIDER` (`stripe`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `ORG_PORTAL_URL`, validated by `paymentsConfig()`.
- Every checkout we open is a `paymentSessions` row (`open`, `complete` or `expired`), unique on the provider's session id, holding its purpose (the plan it charges) and amount. A session event is applied by that row, never by the provider's metadata: an unknown session is acknowledged and ignored, and a closed one changes nothing. Only a paid checkout binds a provider subscription to an organization. Opening a checkout expires the organization's older open session at the provider. A second live subscription for an organization is logged as an error and recorded in `paymentEvents` with outcome `stray`, for an operator to settle.

## Who sees what

`portal-pages.ts` maps each page to the org action it needs; pages a role lacks are not in its nav, and their data answers null.

| Page | Owner | Admin | Member |
|---|---|---|---|
| Overview | everything | everything, no billing buttons | name, own role, own engines |
| Plan & billing | full | read-only | hidden |
| Members | change roles, remove | change roles (not the owner), remove | hidden |
| Engines | rename, open | rename, open | open the ones they're on |
| Discounts & invoices | full | hidden | hidden |

The Engines page lists the organization's engines and has no way to add one. An organization's first engine comes from onboarding.

Plan & billing picks its content in `billing-view.ts`: an organization with only self-hosted engines reads "No subscription needed for self-hosted engines"; an exempt one shows its plan with no buttons; a running provider subscription offers "Manage billing" (the provider's portal); otherwise the owner chooses a plan and checks out. List prices in `format.ts` must match the provider's prices and the marketing pricing page.

## Entry points

"Manage organization" in the profile menu and on the Team page, for org owners and admins, on a hosted engine, in the web build (`useCanManageOrganization`). Billing banners and emails link to `/org/billing`.
