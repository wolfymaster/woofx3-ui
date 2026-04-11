# Assets

**Route:** `/assets`  
**Primary file:** `client/src/pages/assets.tsx`

## Purpose

**Media and file management** for the current instance: upload, organize into folders, filter by type, sort, download, delete, and bulk actions.

## Behavior

- Scoped with **`useInstance()`** — all operations are tied to the selected instance’s `instanceId`.
- Uses **Convex** for listing, folder structure, and mutations, and **Convex actions** where needed for **signed upload URLs** or storage backends (see `generateUploadUrl`-style flows in the page).
- Storage is abstracted on the Convex side (`convex/lib/storage/`) so instances can use Convex storage, R2, or local adapters depending on configuration.

## UX notes

- Supports **grid and table** layouts, search, type filters (image, video, audio, etc.), and confirmation dialogs for destructive actions.

When extending assets, preserve the pattern: **metadata in Convex**, **blobs** via the storage adapter / upload URL flow, never direct browser → arbitrary cloud without going through the backend.
