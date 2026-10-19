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
   `marketplaceCatalog.createCheckout` takes a return **path**, never a URL,
   and joins it onto `APP_BASE_URL` on the server — so a Stripe payment page
   can only ever return the buyer into woofx3. A purchase spends the account's
   money, so it needs `admin`. The marketplace charges its own quote.
2. Stripe sends the buyer back to the listing with `?purchase=success`. The
   entitlement is granted by a webhook from Stripe to the *marketplace*, a
   separate round trip, so the page reads the quote again and says so rather
   than assuming the button has already flipped.
3. The button becomes **Install**.

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
anonymously at the instance's own catalog access first, which is how free
content is served and keeps dev-tier listings hidden from instances not
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

- the instance does not have dev marketplace access (the engine reads
  `/catalog/{id}` anonymously, where dev-tier listings do not exist);
- `MARKETPLACE_BUYER_SIGNING_KEY` and `_KEY_ID` are set, so a buyer token can
  be minted;
- the engine reports capability `modules.marketplaceInstall`.

Otherwise everything above runs unchanged. An engine that cannot answer for
its capabilities also gets the Convex path. On the engine path, the module install (`installMarketplaceListing`),
the bundle install (`installMarketplaceBundle`), the file list of a module not
yet installed and the setup platform review (`inspectMarketplaceListing`) each
get a fresh buyer token. The engine calls `acquire` itself with that token,
which also counts the install, so Convex does not call `acquireListing` there.
Inspecting acquires nothing.

A module install also reads the listing from `/catalog/{id}` first, for its
name and its manifest id (`moduleKey`), which the engine's install key must
start with.

What differs on the engine path:

- `payment_required` becomes the same "hasn't been bought on this account"
  error a 402 from `acquireListing` raises. Other refusals (a 409 for an
  unpriced or superseded listing, a 404) reach the browser as a ConvexError
  carrying the engine's message, because capnweb passes only an error's
  message and the engine reports those refusals by throwing.
- The engine acquires before it checks consent, so a module install that
  comes back `needs_approval` has already claimed a free listing.
- The install key is only known once the engine has hashed the archive, so
  the `module.install` progress event is written after the engine answers,
  and skipped when the engine's own callback already settled the key. A
  failure before that is reported by the action itself; the browser only
  watches the key the action returns.
- Reading one file of a module that is not installed still uses the archive
  fetched by Convex, because the engine has no call for it.

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
timeout. Both this page and [`/modules`](./modules.md) drive it. Those three
parts only work as a set, and a second copy would have drifted from the first.

## Environment

| Variable | Needed for |
|---|---|
| `MARKETPLACE_API_URL` | Everything. The marketplace API's origin. |
| `MARKETPLACE_DEV_TOKEN` | Revealing dev-tier listings to flagged instances. |
| `MARKETPLACE_API_TOKEN` | Acquire, quotes, checkout and ownership reads. The marketplace gates those on its write token. Never reaches the browser. |
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
