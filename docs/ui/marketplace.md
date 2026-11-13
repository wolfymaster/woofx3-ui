# Marketplace

**Routes:** `/marketplace`, `/marketplace/listing/:listingId`, `/marketplace/author/:slug`
**Primary files:** `client/src/pages/marketplace.tsx`, `client/src/pages/marketplace-listing.tsx`, `client/src/pages/marketplace-author.tsx`, `client/src/components/marketplace/`, `client/src/hooks/use-marketplace.ts`, `convex/marketplaceCatalog.ts`, `shared/marketplace-catalog.ts`

The storefront. [Modules](./modules.md) covers the installed modules and uploads beside it in the same tab.

The storefront, listing and author pages render inside one route (`client/src/pages/marketplace-section.tsx`), which owns the catalog rail and its overview read, so moving between them keeps the rail in place. Rail selections are URLs, parsed by `parseMarketplaceFilter`.

## Where the catalog lives

In `woofx3-marketplace-api`, not here. This deployment is a **proxy**: it holds
no catalog rows at all. The one thing it adds is identity — the marketplace has
no user model, so the buyer is an opaque `account:{accountId}` minted in
`convex/lib/marketplaceEntitlement.ts` and never parsed on the other side.

Everything the storefront reads goes through the engine gateway's `marketplace`
namespace: search, a listing, an author's page and the counts per type, plus the
account's quotes, entitlements and checkout. In the hosted app those are the
actions in `convex/marketplaceCatalog.ts`. They are requests, not subscriptions:
the catalog is an HTTP service, so none of it is reactive. `use-marketplace.ts` does the one
thing that follows from that: every fetched result is tied to the inputs it was
fetched for, and a result belonging to a different engine, query or listing is
never rendered. A stale render here is a streamer installing something they were
not looking at.

Nothing trusts the marketplace's shape. `shared/marketplace-catalog.ts`
checks every field and drops an entry it cannot parse rather than rendering it
half-formed, the way module listings have always been treated. `total` still
comes from the marketplace, so a dropped entry cannot make "48 of 312" lie.

## Local mode

The desktop app's local mode has no account, so it browses the catalog
anonymously through its own engine: the direct gateway calls the engine's
`marketplaceSearch`, `marketplaceGetListing`, `marketplaceGetAuthor` and
`marketplaceCounts` with no buyer token, and parses the marketplace JSON they
pass through with the same parsers (`shared/marketplace-catalog.ts`). Free
listings install through the engine; the engine refuses a paid one, and asks
the streamer to sign in.

Buying needs an account, so local mode's marketplace mode has no purchases.
Nothing asks for a quote or for ownership, and the listing page's button reads
the public pricing instead (`listingInstallState`): a free listing installs, a
retired or unpriced one is unavailable, and one that costs money shows
**Sign in to buy**.

## Listing types

| Type | What it is | How it installs |
|---|---|---|
| `module` | The existing module format | Unchanged: `api.marketplace.installModule` |
| `theme` | Reskins a widget of another module | The same path — a theme pack *is* a module archive |
| `emote` | An image pack. No code, no behaviour | Nothing to install; the images are the product |
| `overlay` | A prepackaged scene | `marketplaceCatalog.installBundle` → `createScene` |
| `alert` | A prepackaged alert composition | `installBundle` → `createAlertComposition` |

A bundle install writes its document through the same engine calls the scene
editor and the alert library already use. Nothing reaches the module runtime,
which is the whole reason overlays and alerts are not modules.

A theme declares the module it reskins, and the page refuses to offer Install
until that module is present — the engine enforces `requires` at install, so
without this the failure would surface as an engine error with the real reason
buried.

## Module and theme listing pages

A module or theme listing's page is the module's whole page, not a summary of
it. Under the header it has tabs (`ListingModuleTabs`, with the tab in
`?tab=`):

- **Overview**: the README, with what the module may do and reach beside it
  (its permissions, its local endpoints, and what an update would add), plus the
  catalog's credits, themes and requirements.
- **What's inside**: its actions, functions, triggers, widgets and workflows.
  A function opens its source file.
- **Files**: the module's file browser.
- **Settings** and **Resources**, once it is installed: the same settings,
  webhook endpoints, local endpoint routing and resource instances as
  an installed module's page (`/marketplace/installed/:id`).

These come from `moduleDetail.getModuleDetail` for the listing, the action
an installed module's page uses, and the tabs reuse that page's components
(`module-detail-panel.tsx`). The page reads the detail again whenever the
installed version changes, so installing turns on the settings tab. An
integration's connect button returns to the page, which finishes the connect
(the marketplace mode's `useOAuthReturn`) and opens the settings tab. Remove opens the same
`UninstallModuleDialog` as the installed-module page.

## Search and categories

One box for the whole marketplace: name, description, author and tags, across
every type, run **on the server**. So a query is a round trip, not a filter over
a cached list, and `useDebounced` keeps typing from firing one request per
keystroke.

The page makes two catalog reads on purpose:

- an **overview** (unfiltered, newest first) backing the sidebar counts, the
  featured hero and the discover rails, because those describe the whole catalog
  and must not change as the grid is filtered;
- a **result page** for the grid, fetched only while something is actually being
  searched or filtered.

The category rail puts the five listing types first — a closed set, so they get
real icons and fixed hues from `lib/listing-type.tsx` and appear in the same
order every time — then the free-text module categories from manifests, which
keep the hash-derived colour the module store has always used
(`module-category.tsx`). The non-module types appear only as types, so an emote
pack is not counted twice.

## Credits

`CreditsCard` is a designed showcase, not a metadata row: the streamers whose
ideas a listing borrows are the reason it exists, so the card gives them
avatars, roles and a link out. Credits also ride on the list response, so a grid
renders them without a request per card. A module or theme shows the card in its
overview's side rail, and on its installed page when it came from a listing;
other listing types have no rail and show it full width.

## Previews

`PreviewButton` renders nothing when there is nothing honest to show, rather
than putting a dead button on half the catalog. What a preview *is* depends on
the type:

- an **emote pack** previews as its own rendered emotes — the images are the
  product, so `EmoteGrid` on the page is the preview;
- a listing with `previews[]` shows that gallery (screenshots and video the
  author supplied);
- a **module with placeable widgets** offers the live path, which is the scene
  editor's own preview surface;
- a **theme** previews the widget it reskins, read off its `target` — a theme
  has no widgets of its own, so without this it would be the one type with
  nothing to show;
- a module with none of the above gets no button.

`lib/listing-preview-target.ts` holds that per-type answer, tested without
rendering anything.

Animated emotes are served from the original uploaded bytes, not the WebP
renditions, so they actually move.

## Pricing, quotes and editions

Every listing is priced explicitly on the marketplace: `pricing` is
`{mode: "free"}`, `{mode: "paid", amountCents, currency, upgrade}`, or `null`.
**`null` means nobody can install it yet, never free**, and a pricing shape the
parser does not recognise is read as `null` too. Cards show **Unavailable** for
it.

A new sellable version of a module is a separate listing — an **edition**,
`{moduleKey}-v{n}` — with its own price. Owning one edition does not entitle
another. A paid edition may give holders of an earlier edition a discounted or
free upgrade. Once a newer edition is published, the older one leaves the grid,
but its page still works for the accounts that hold it and points them at the
new one (`supersededBy`).

Every edition of a module installs under its manifest id (the listing's
`moduleKey`): the install key is `{manifest id}:{version}:{sha7}` on both
install paths, because barkloader computes the key from the archive and
refuses any other. Edition 2 therefore replaces edition 1 in place, and
edition 1's key is the one it always had (its listing id is its manifest id).
Since the key no longer says which listing is installed, a `moduleRepository`
row carries `marketplaceListingId` and `marketplaceEdition`, read through
`installedListing` (`convex/lib/marketplaceInstallIdentity.ts`). They come
from the engine's install provenance (`listEngineModules`, applied by the
modules sync step) or, for an install Convex started, from the record it wrote
under the key (`marketplaceInstalls`), applied when `module.installed` arrives.
A row with neither falls back to the key's first segment; that is right for
every module installed before editions could install, since only first
editions could. So edition 1 installed shows edition 2's page as the upgrade
its quote names, and an earlier edition's page reads as installed while a later
one is, rather than offering to replace it.

What one account must do to hold one listing is a **quote**, decided by the
marketplace (`marketplaceCatalog.quote`): `owned`, `free`, `upgrade_free`,
`upgrade` (the discounted price), `full`, or `unavailable` with a reason. The
listing page's button reads only the quote, through `useMarketplaceQuote`,
because only the marketplace knows what the account holds.
`lib/listing-install-state.ts` turns it into the button's state, with the
precedence in one place. While the quote loads the button waits, and when it
cannot be read the button says so rather than guessing; a free listing installs
without waiting.

Grids read ownership once (`marketplaceCatalog.entitlements`), not a quote per
card, so a card shows **Buy · $X** for a paid listing the account does not hold.

## Purchase → install

1. A listing the quote prices shows **Buy for $X** (or **Upgrade for $X**).
   Buying starts by claiming the listing
   (`marketplaceCatalog.acquireForInstall`), which answers with the purchase
   the marketplace quoted: the amount is the intent's, never the caller's. A
   purchase spends the organization's money, so it needs the organization's
   `manageBilling` (its owner), whatever the caller's role on the engine.
2. The management plane opens the checkout for that intent
   (`billingCommands.startMarketplaceCheckout`). It owns the payment provider
   and builds the return itself, so the payment page sends the browser back to
   the listing with `?checkout=done&checkoutId=…`.
3. The page follows the payment: it reads the checkout's state
   (`marketplaceCatalog.checkoutState`) until it settles, then claims the
   listing again, because the marketplace grants the entitlement behind the
   payment, in a separate round trip. The button becomes **Install**.

Every listing type buys this way, bundles included: a bundle's install writes
a scene or an alert composition rather than a module, but the purchase is the
same purchase.

**The gate is on the server, and it fails closed.** Both install paths call
`acquireListing` (`convex/lib/marketplaceEntitlement.ts`) before the engine is
asked to install anything — for a module, after the streamer approves its
permissions, so backing out acquires nothing.

- With `MARKETPLACE_API_TOKEN` set, it is the marketplace's
  `POST /catalog/{id}/acquire`: it claims a free listing or a free upgrade,
  confirms one already held, and refuses one that costs money (402) or that
  nobody can acquire (409, with the marketplace's reason). A free claim is
  also what counts the install, so counts are accounts, not install clicks.
- Without the token nothing can be recorded, so only a listing the public
  catalog prices `free` installs.

Content — a module archive or a bundle — is fetched by `fetchListingContent`:
anonymously at the engine's own catalog access first, which is how free
content is served and keeps dev-tier listings hidden from engines not
flagged for them; then, only on a 401 (visible but not free), with the write
token as the buyer. The marketplace serves it only to an account that holds
the listing. Previews — the module detail's permission read, the file browser
for a module not yet installed, setup platforms — use the same fetch without
acquiring anything.

### Installing on the engine

On an engine that supports it, the engine does the fetching and the acquire
instead (`convex/lib/marketplaceEngineInstall.ts`).
`marketplaceEngineFor` picks the path per call, and takes the engine only when
all of these hold, checked cheapest first:

- the engine does not have dev marketplace access (the engine reads
  `/catalog/{id}` anonymously, where dev-tier listings do not exist);
- `MARKETPLACE_BUYER_SIGNING_KEY` and `_KEY_ID` are set, so a buyer token can
  be minted;
- the engine answers (`getEngineInfo`).

Otherwise everything above runs unchanged. On the engine path, the module install (`installMarketplaceListing`),
the bundle install (`installMarketplaceBundle`), the file list of a module not
yet installed and the setup platform review (`inspectMarketplaceListing`) each
get a fresh buyer token. The engine calls `acquire` itself with that token,
which also counts the install, so Convex does not call `acquireListing` there.
Inspecting acquires nothing.

A module install also reads the listing from `/catalog/{id}` first, for its
name and its manifest id (`moduleKey`), which the engine's install key must
start with.

What differs on the engine path:

- `payment_required` becomes the same "hasn't been bought in this
  organization" error a 402 from `acquireListing` raises. Other refusals
  arrive as a thrown error, because capnweb passes only an error's message.
  The engine writes a marketplace refusal in the catalog error format
  (`marketplace_http status=... code=...`), so `engineFailure` reads the code
  back and tells it in written copy (`activation_limit`, `not_entitled`,
  `buyer_mismatch`, and the codes acquire refuses with); an unknown code gets
  a generic line, and the raw text goes to the log. `listing_unavailable`
  keeps the marketplace's message, which it writes for a person. An engine
  failure that is not a marketplace refusal passes its message on as it is.
- The engine acquires before it checks consent, so a module install that
  comes back `needs_approval` has already claimed a free listing.
- The install key is only known once the engine has hashed the archive, so
  the `module.install` progress event is written after the engine answers,
  and skipped when the engine's own callback already settled the key. A
  failure before that is reported by the action itself; the browser only
  watches the key the action returns.
- Reading one file of a module that is not installed still uses the archive
  fetched by Convex, because the engine has no call for it.

## Licensed installs

An engine that reports the `marketplace.licenseKeys` capability installs a
module or theme listing with the organization's **license key**, and claims
nothing itself. The browser runs the install as a state machine
(`client/src/lib/install-flow.ts`), driven by `useLicensedModuleInstall` in
`hooks/use-module-install.ts`.

### The actions

- **`marketplaceCatalog.acquireForInstall`** asks the marketplace's
  `POST /catalog/{id}/acquire` for the organization's buyer. It answers one of
  three outcomes (`convex/lib/marketplaceLicense.ts`): `licensed` with the
  license (`key`, `listingId`, `edition`); `payment_required` with the purchase
  intent to pay (id, amount, currency, `full` or `upgrade`, expiry), from a 402;
  or `refused` with a reason and a line written for the streamer
  (`acquireOutcomeOfError`). Asking again is safe: a held listing answers the
  same key, an unpaid one the same intent. An acquire answer without a license
  throws, because a marketplace that cannot issue keys cannot serve this flow.
- **`marketplace.installWithLicense`** hands the key, the listing id and the
  streamer's approvals to the engine's `installMarketplaceListing`. The engine
  downloads the build with the key and checks the manifest it fetched against
  the approvals, so the browser can neither substitute a file nor install a
  permission nobody approved: a build asking for more answers `needs_approval`.
- **`marketplaceCatalog.licenseKey`** reads the key the organization holds for
  one listing from `GET /entitlements`, for the module page's key control.

Any member may acquire and install. Only the organization's owner
(`manageBilling`) may pay, and only its owner and admins (`viewBilling`) may
read a key. Both are checked on the organization that owns the engine
(`requireOrgActionOnInstanceInAction`), and the browser reads the same answer
from `organizations.capabilitiesForInstance` through the session gateway's
`useOrganizationAccess`.

### The license key

A key downloads the module, so it is a credential. It travels from the
marketplace through Convex to the browser and on to the engine, and Convex
neither logs nor stores it. The key control (`ModuleLicenseKey`) mounts only
for a caller who may see keys, so anyone else is never sent one; it shows the
key masked until asked.

### The state machine

`transition(state, event)` is pure: it returns the next state and at most one
named command (`acquire`, `start_payment`, `open_checkout`, `read_checkout`,
`install`; `acquire` and `read_checkout` may say to wait first), and
the hook runs the command and feeds its answer back as an event. Each flow
gets a generation, so a late answer from a flow the streamer left changes
nothing.

| Step | Means | Leaves on |
|---|---|---|
| `idle` | Nothing running | `install_requested` → `consenting`, or `acquiring` when nothing new needs approval |
| `consenting` | The approval dialog is open | approve → `acquiring`; cancel → `idle` |
| `acquiring` | `acquire` running | `licensed` answer → `installing`; `payment_required` → `needs_payment` (owner) or `failed` (anyone else); refused → `failed` |
| `needs_payment` | Starting the checkout | a checkout URL → the browser goes to it; billing refusing → `failed` |
| `finalizing_payment` | Back from paying | see below |
| `licensed` | Held after a payment, ready to install | dismissed → `idle` |
| `installing` | The engine has the build; `moduleKey` once it accepted | the engine's report → `installed` or `failed`; `needs_approval` → `consenting` with only what is new |
| `installed`, `failed` | Done | dismissed → `idle` |

### Paying and coming back

`start_payment` calls `billingCommands.startMarketplaceCheckout` with the
intent's id. It asks the management plane
(`POST /v1/billing/accounts/{id}/marketplace-checkouts`) to open a checkout for
the organization that owns the engine; only its billing manager may, and the
plane checks the intent is that organization's, open and payable, and charges
its amount. A refusal (an intent about to expire, already paid, the listing
off sale) comes back with its code and a line for the streamer.

The payment page returns to the listing with `?checkout=done&checkoutId=...`
(or `cancelled`, which only shows a banner). The page hands the checkout to
the flow as `payment_returned`, and `finalizing_payment` follows it in two
phases:

1. **checkout**: `read_checkout` asks `billingCommands.marketplaceCheckoutState`
   until billing says `complete`. `expired` fails with "nothing was charged";
   `needs_review` (paid, but the grant failed, which support settles) fails
   pointing to support.
2. **entitlement**: billing grants the listing after the payment, so `acquire`
   is asked again until it answers `licensed`, and the flow moves to
   `licensed` for the streamer to install.

The return names only the checkout, so the browser remembers which engine
opened it (`lib/purchase-engines.ts`, in local storage, keyed by checkout id).
On the return the page selects that engine first (`usePurchaseReturnEngine`),
when the caller is still on it, and otherwise follows the purchase on the
engine already selected; storage that is blocked or empty changes nothing
else. A checkout billing does not know for the engine's organization
(`checkout_not_found`, a malformed id, or a caller who may not manage that
organization's billing) is decided, so the wait ends at once as
`payment_elsewhere` and asks the streamer to switch engines; only outages are
asked again. Once the purchase is `licensed` (or installed), the page drops
`checkout`, `checkoutId` and `purchase` from the address, so a reload does not
follow it again.

The runner (`lib/install-runner.ts`) parks its waits when the hook unmounts
and arms them again when it mounts, as React's StrictMode does on every
mount, so a flow survives a remount; answers that arrive while it is
unmounted are dropped.

Both phases share one bound, `CHECKOUT_POLL` (`lib/checkout-return.ts`, the
same one the plan checkout's return uses): every unanswered or unfinished ask
counts. Past it the flow fails as `payment_pending` and keeps the purchase,
and **Check again** (`purchase_rechecked`) starts following it again; nothing
is charged twice, since billing refuses a second checkout for a paid intent.
A return that names no checkout waits on the grant alone. A refund after the
grant revokes the entitlement, so a later acquire is refused as
`entitlement_revoked`.

Consent comes before acquire, so a streamer who backs out claims nothing.
Every command is idempotent, so a reload starts again from what the
marketplace and the engine say.

### Transitional paths

These cover engines and purchases the licensed flow does not reach yet. Each
must be deleted once its condition holds:

- **The unlicensed install** (`useUnlicensedModuleInstall`, the Convex
  `installModule` action) runs on an engine without `marketplace.licenseKeys`.
  Buying on such an engine is refused outright: the purchase needs the same
  capability, because the license the install carries is what the marketplace
  grants it.
- **The Convex download path** in `installFromMarketplace` fetches the archive
  in Convex without a key. Both go once every engine reports the capability,
  which nothing counts yet, and before the marketplace requires a key for every
  download, which would break them.

## Author pages

Every listing is attributed to the **username** it was published under
(`authorSlug`). The page is `/marketplace/author/{username}`, and the
marketplace looks it up by that username and pages the listings itself, so
the page loads 48 at a time with **Show more**. The manifest's `author` is only
the name a card shows. An `authors` profile on the marketplace side adds a
display name, bio, avatar and links; until there is one (`claimed: false`) the
page shows the username.

Listings are grouped by type rather than shown as one grid, because "what does
this person make" is the question the page answers.

## Install flow sharing

`hooks/use-module-install.ts` is the one implementation of a marketplace module
install: the permission approval gate, the engine's progress events, and the
timeout. Both this page and the [installed modules page](./modules.md) drive it. Those three
parts only work as a set, and a second copy would have drifted from the first.

## Environment

| Variable | Needed for |
|---|---|
| `MARKETPLACE_API_URL` | Everything. The marketplace API's origin. |
| `MARKETPLACE_DEV_TOKEN` | Revealing dev-tier listings to flagged engines. |
| `MARKETPLACE_API_TOKEN` | Acquire, quotes and ownership reads. The marketplace gates those on its write token. Never reaches the browser. |
| `MARKETPLACE_BUYER_SIGNING_KEY` | Minting buyer tokens (`buyerTokenFor`). The Ed25519 private key as JWK JSON. A secret. |
| `MARKETPLACE_BUYER_SIGNING_KEY_ID` | Minting buyer tokens. The `kid` the marketplace knows the public key by. |

Without `MARKETPLACE_API_TOKEN`, the catalog browses
normally and paid listings cannot be bought or installed.

A buyer token is a five-minute Ed25519 JWS that lets an engine act for one
account (`sub` is the same `account:{id}` as `buyerRef`) on the marketplace's
acquire, quote, entitlement, bundle and download routes, without the write
token. `bun scripts/marketplace-buyer-keygen.ts <kid>` generates a key pair and
prints both the Convex values and the marketplace's `CONTROL_PLANE_PUBLIC_KEYS`
entry. Give the marketplace the public key before setting the Convex values:
until it lists the key, it refuses every token signed with it. Minting throws
when either variable is unset, and nothing else depends on them.
