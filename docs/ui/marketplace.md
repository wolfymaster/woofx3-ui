# Marketplace

**Routes:** `/marketplace`, `/marketplace/listing/:listingId`, `/marketplace/author/:slug`
**Primary files:** `client/src/pages/marketplace.tsx`, `client/src/pages/marketplace-listing.tsx`, `client/src/pages/marketplace-author.tsx`, `client/src/components/marketplace/`, `client/src/hooks/use-marketplace.ts`, `convex/marketplaceCatalog.ts`, `convex/lib/marketplaceCatalog.ts`

The storefront. [Modules](./modules.md) covers the install surface it leads to.

## Where the catalog lives

In `woofx3-marketplace-api`, not here. This deployment is a **proxy**: it holds
no catalog rows at all. The one thing it adds is identity — the marketplace has
no user model, so the buyer is an opaque `account:{accountId}` minted in
`convex/lib/marketplaceEntitlement.ts` and never parsed on the other side.

Everything the storefront reads goes through actions in
`convex/marketplaceCatalog.ts`, which are **actions, not queries** — the catalog
is an HTTP service, so none of it is reactive. `use-marketplace.ts` does the one
thing that follows from that: every fetched result is tied to the inputs it was
fetched for, and a result belonging to a different instance, query or listing is
never rendered. A stale render here is a streamer installing something they were
not looking at.

Nothing trusts the marketplace's shape. `convex/lib/marketplaceCatalog.ts`
checks every field and drops an entry it cannot parse rather than rendering it
half-formed, the way module listings have always been treated. `total` still
comes from the marketplace, so a dropped entry cannot make "48 of 312" lie.

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
renders them without a request per card.

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

## Purchase → install

1. A paid listing shows **Buy for $X**. `marketplaceCatalog.createCheckout`
   takes a return **path**, never a URL, and joins it onto `APP_BASE_URL` on the
   server — so a Stripe payment page can only ever return the buyer into
   woofx3. A purchase spends the account's money, so it needs `admin`.
2. Stripe sends the buyer back to the listing with `?purchase=success`. The
   entitlement is granted by a webhook from Stripe to the *marketplace*, a
   separate round trip, so the page re-reads entitlements and says so rather
   than assuming the button has already flipped.
3. The button becomes **Install**.

Ownership is read once for a whole grid (`marketplaceCatalog.entitlements`),
not per card.

**The gate is on the server, and it fails closed.** `requireEntitlement` runs
before any marketplace content is fetched: both install paths, the file browser
for a module not yet installed, the module detail's permission read, and setup
platforms. It returns how to fetch the content. A free listing's archive or
bundle is fetched as before; a paid listing's is fetched with
`MARKETPLACE_API_TOKEN` and the buyer, because the marketplace serves paid
content to nobody else.

- With the token set, the marketplace's entitlement read is the only answer
  trusted, and an answer it does not recognise refuses the install.
- Without the token, a listing counts as free only when the public catalog
  shows no price at all. Any price, or a listing that cannot be read, refuses
  the install. Free installs therefore still need no new configuration.

When ownership cannot be read at all, the button says **Buy**, not Install: the
server refuses an install it cannot verify either, so Install would produce a
failure the streamer could not act on. `lib/listing-install-state.ts` holds that
precedence in one place.

### Installing on the engine

Behind flag `marketplace.engineInstall`, the engine does the fetching instead
(`lib/marketplaceEngineInstall.ts`). `marketplaceEngineFor` picks the path per
call, and takes the engine only when all of these hold:

- the instance does not have dev marketplace access (the engine reads
  `/catalog/{id}` anonymously, where dev-tier listings do not exist);
- the flag is on for the instance (`featureFlags.isOnForInstance`, so percent
  rollouts bucket by account and `hosting: "managed"` targets managed engines);
- the engine reports capability `modules.marketplaceInstall`.

Otherwise everything above runs unchanged. On the engine path, the module
install (`installMarketplaceListing`), the bundle install
(`installMarketplaceBundle`), the file list of a module not yet installed and
the setup platform review (`inspectMarketplaceListing`) each get a fresh buyer
token. The engine claims the listing with `acquire`, which also counts the
install, so no install count is sent from Convex. Results and refusals keep
the Convex path's shapes and texts: `payment_required` becomes the same
"has not been purchased on this account" error `requireEntitlement` raises.

Two things differ. The install key is only known once the engine has hashed
the archive, so the `module.install` progress event is written after the
engine answers, and skipped when the engine's own callback already settled
the key. Reading one file of a module that is not installed still uses the
archive fetched by Convex, because the engine has no call for it.

## Author pages

`modules.author` has always been free text, so the author **slug is derived**
from it rather than introduced as an id. Every module published before author
pages existed therefore has a page, with no backfill and no author-account
model. An `authors` row on the marketplace side only enriches it; `claimed` in
the response says which, and the page tells the reader so.

Listings are grouped by type rather than shown as one grid, because "what does
this person make" is the question the page answers.

## Install flow sharing

`hooks/use-module-install.ts` is the one implementation of a marketplace module
install: the permission approval gate, the engine's progress events, and the
timeout. Both this page and [`/modules`](./modules.md) drive it. Those three
parts only work as a set, and a second copy would have drifted from the first.

## Environment

| Variable | Needed for |
|---|---|
| `MARKETPLACE_API_URL` | Everything. The marketplace API's origin. |
| `MARKETPLACE_DEV_TOKEN` | Revealing dev-tier listings to flagged instances. |
| `MARKETPLACE_API_TOKEN` | Checkout and entitlement reads. The marketplace gates those on its write token. Never reaches the browser. |
| `APP_BASE_URL` | Checkout. The origin a return path is joined onto. |
| `MARKETPLACE_BUYER_SIGNING_KEY` | Minting buyer tokens (`buyerTokenFor`). The Ed25519 private key as JWK JSON. A secret. |
| `MARKETPLACE_BUYER_SIGNING_KEY_ID` | Minting buyer tokens. The `kid` the marketplace knows the public key by. |

Without `MARKETPLACE_API_TOKEN` and `APP_BASE_URL`, the catalog browses
normally and paid listings cannot be bought or installed.

A buyer token is a five-minute Ed25519 JWS that lets an engine act for one
account (`sub` is the same `account:{id}` as `buyerRef`) on the marketplace's
acquire, quote, entitlement, bundle and download routes, without the write
token. `bun scripts/marketplace-buyer-keygen.ts <kid>` generates a key pair and
prints both the Convex values and the marketplace's `CONTROL_PLANE_PUBLIC_KEYS`
entry. Give the marketplace the public key before setting the Convex values:
until it lists the key, it refuses every token signed with it. Minting throws
when either variable is unset, and nothing else depends on them.
