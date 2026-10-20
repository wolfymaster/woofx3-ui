# Media

**Route:** `/stream/assets`  
**Primary file:** `client/src/pages/assets.tsx`

## Purpose

**Media and file management** for the current instance: upload, organize into folders, filter by type, sort, download, delete, and bulk actions.

## Behavior

- Scoped with **`useInstance()`** — all operations are tied to the selected instance’s `instanceId`.
- Resources are the engine's: every call goes through the Convex actions in `convex/resources.ts`, which proxy to the engine. Uploads (`useResourceUpload`) ask for a grant (`requestUpload`), PUT the file straight to storage with the grant's headers, then confirm (`completeUpload`). Bytes never pass through Convex.
- A grant is bound to the file's exact size, so storage refuses a body of any other length. The browser sends `Content-Length` from the file itself; the hook skips that header in the grant because page code may not set it.

## Hosted storage limits

A managed engine on the storage maintenance provisioned for it is limited by the account's plan: `storage.hostedAssetBytes` in total and `storage.hostedFileBytes` per file (defaults 50 MB and 10 MB; see [Entitlements](../patterns/entitlements.md)). `requestUpload` refuses an upload that would pass either, with a sentence the upload dialog shows. Self-hosted engines, and managed ones whose admin has moved them onto a bucket and credentials of their own, have no limit (`isOnHostedStorage` in `convex/lib/hostedStorage.ts`).

Usage is the engine's own total of its resources (`getResourceUsage`) plus reservations in `hostedStorageReservations`, held while each grant is issued so concurrent uploads cannot all pass against the same total. The Media page shows a meter (`hostedStorageUsage`) when a limit applies.

## UX notes

- Supports **grid and table** layouts, search, type filters (image, video, audio, etc.), and confirmation dialogs for destructive actions.

When extending assets, preserve the pattern: the engine holds the records, Convex issues every grant, and the browser only ever PUTs to a URL a grant gave it.

## Picking media for a setting

Every `media` / `asset` config field (scene widget settings, alert layers, workflow actions, module and resource settings) renders through one picker, `AssetLibraryModal` in `client/src/components/workflows/asset-library-modal.tsx`, via `configFieldRenderers`. It offers three tabs: **Library**, **Upload**, and **URL** for a file hosted elsewhere (absolute `http`/`https` only, with an image, video or audio preview).

The stored value is a `MediaValue` (`client/src/lib/media-value.ts`). A library file is `{ id, name, url, type }`; an external URL is `{ source: "url", name, url, type }` with no resource id. Renderers read only `url`, so both play the same way in overlays and previews.
