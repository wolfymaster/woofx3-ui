# Engine: `installModuleFromUrl` RPC — Design Spec

**Date:** 2026-05-17
**Status:** Approved for implementation
**Scope:** woofx3 engine (`~/code/wolfymaster/woofx3/api`) + shared API types (`~/code/wolfymaster/woofx3/shared/clients/typescript/api`)
**Companion spec:** [`2026-05-17-marketplace-browse-design.md`](./2026-05-17-marketplace-browse-design.md)

## Problem

The UI's new marketplace Browse tab installs modules by handing the engine a **presigned R2 GET URL**. Today the engine only accepts module bytes inline via `installModuleZip(fileName, zipBase64, ctx)`. For a marketplace install the UI flow looks like:

1. Browser clicks Install in the modules detail panel.
2. Convex action `marketplace.installModule` calls the marketplace's `/modules/{id}/download` and gets back `{ url, expires_at }`.
3. Convex needs to hand that URL to the engine — **without ever streaming the zip bytes through Convex**, since (a) it doubles the bandwidth, (b) Convex actions have memory and execution-time limits, and (c) the URL has a 5-minute TTL and Convex would just be a pointless middle layer.

The engine is the natural place to fetch the bytes: it's server-side, it has a persistent identity with the marketplace's origin, and it already owns the barkloader integration. We need a new RPC method that takes a URL instead of a base64 payload, and otherwise plugs into the existing `module.installed` / `module.install_failed` webhook pipeline unchanged.

## Non-goals

- Verifying signatures or hashes on the downloaded archive (deferred — the marketplace presigning is the trust mechanism for v1).
- Storing the marketplace source/id on the engine's `modules` table (Convex retains source-of-truth for marketplace metadata; engine only needs `moduleKey` to correlate webhooks).
- Resumable downloads, chunked transfers, or progress streaming back to the UI. Install is fire-and-forget like `installModuleZip`.
- Authenticating the marketplace fetch with custom headers — the presigned URL carries its own auth.

## Architecture

```
Convex action `marketplace.installModule`
     │
     │  rpc.installModuleFromUrl(presignedUrl, moduleKey, {
     │      name, version, source: "marketplace", marketplaceModuleId
     │  })
     ▼
ApiSession.installModuleFromUrl  ── injects clientId
     │
     ▼
Api.installModuleFromUrl
     │
     ├─ duplicate check: getModuleByModuleKey(moduleKey)
     │      └─ if hit: emit module.installed webhook (alreadyInstalled=true), return
     │
     ├─ fetch(presignedUrl) ── server-side, with timeout + size cap
     │
     ├─ build FormData with file + client_id + module_key
     │
     └─ POST /functions → barkloader (same path installModuleZip uses today)
            │
            ▼
       barkloader installs the module asynchronously,
       writes db.module.installed / db.module.install_failed
            │
            ▼
       NATS subscriber in Api fires module.installed /
       module.install_failed webhook back to Convex,
       echoing moduleKey.
```

The existing webhook-correlation pipeline (`Api.subscribeModuleInstallEvents` / NATS → `webhookClient.send`) requires **zero changes** — barkloader carries `module_key` through the `db.module.installed.*` event, the Api forwards it as `moduleKey` in the webhook, and Convex's existing `processModuleInstalled` handler picks it up under the same key the UI is subscribed to.

### Key decisions

- **Engine fetches the URL.** The UI's spec already guarantees the URL never leaves Convex's server runtime; the engine adds the second guarantee that it never leaves the engine's server runtime either. The browser never sees an R2-signed URL.
- **Reuse the barkloader POST `/functions` endpoint.** Barkloader takes a multipart `file + client_id + module_key`; we just plug a different *source* of bytes into the same FormData. No new barkloader endpoint needed.
- **Reuse the duplicate-check.** `installModuleZip` already short-circuits when `getModuleByModuleKey(moduleKey)` returns an existing row and emits a synthetic `module.installed` webhook with `alreadyInstalled: true`. `installModuleFromUrl` does the same — same duplicate semantics across both install paths.
- **`context` carries metadata, not control flow.** `name`, `version`, `source`, and `marketplaceModuleId` are passed through purely so they can be **logged** and **echoed back in webhook payloads** for observability. Barkloader is still the source of truth for what's actually inside the zip; if the marketplace lies about the version, barkloader's parsed manifest wins.
- **Same async contract as `installModuleZip`.** Returns `{ success, message?, alreadyInstalled? }` synchronously to signal *accepted by engine*. Final outcome arrives via webhook, correlated by `moduleKey`.

## Contract

### Shared type addition

In `~/code/wolfymaster/woofx3/shared/clients/typescript/api/api.ts`, add the new method to `Woofx3EngineApi` next to `installModuleZip`:

```ts
export interface Woofx3EngineApi {
  // ...existing methods...

  /**
   * Install a module by URL. The engine fetches the archive server-side from
   * `downloadUrl` (a short-lived presigned URL produced by an upstream
   * marketplace), then hands the bytes to barkloader. Install is asynchronous;
   * `module.installed` or `module.install_failed` is dispatched via webhook
   * once barkloader finishes, correlated by `moduleKey`.
   *
   * `clientId` is injected automatically by the authenticated ApiSession;
   * callers only provide `moduleKey` and the metadata `ctx`.
   *
   * `ctx` is used for logging and for echoing fields back through the
   * webhook payload (so the UI can show "Installing OBS Scenes v1.4.2 from
   * marketplace…" without an extra round-trip). Barkloader's parsed manifest
   * remains the source of truth for the module's actual name/version.
   */
  installModuleFromUrl(
    downloadUrl: string,
    moduleKey: string,
    ctx: {
      name: string;
      version: string;
      source: "marketplace";
      marketplaceModuleId: string;
    }
  ): Promise<ModuleInstallZipResponse>;
}
```

Return type is `ModuleInstallZipResponse` (the existing interface) — same `{ success, message?, alreadyInstalled? }` shape. The UI already handles it.

The `source` field is `"marketplace"` literal in v1. Future install sources (e.g. `"git"`, `"local-development"`) can extend the union without breaking existing callers, but each new source needs an explicit decision about what URL pre-fetch semantics it implies.

### ApiSession override

In `~/code/wolfymaster/woofx3/api/src/api-session.ts`, add an override next to `installModuleZip` so the session injects `clientId`:

```ts
async installModuleFromUrl(
  downloadUrl: string,
  moduleKey: string,
  ctx: { name: string; version: string; source: "marketplace"; marketplaceModuleId: string }
) {
  return this.api.installModuleFromUrl(downloadUrl, moduleKey, {
    clientId: this.clientId,
    moduleKey,
    ...ctx,
  });
}
```

(`moduleKey` appears both as a top-level RPC argument and inside the API-call context for symmetry with `installModuleZip`'s shape — the Api method uses the context version internally.)

### Api implementation

In `~/code/wolfymaster/woofx3/api/src/api.ts`, add `installModuleFromUrl` near the existing `installModuleZip` (~line 2774). Sketch:

```ts
private static readonly MARKETPLACE_FETCH_TIMEOUT_MS = 30_000;
private static readonly MARKETPLACE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

async installModuleFromUrl(
  downloadUrl: string,
  moduleKey: string,
  context: {
    clientId: string;
    moduleKey: string;
    name: string;
    version: string;
    source: "marketplace";
    marketplaceModuleId: string;
  }
): Promise<ModuleInstallZipResponse> {
  const { clientId, name, version, source, marketplaceModuleId } = context;
  if (!clientId) {
    throw new Error("clientId is required to install a module");
  }
  if (!moduleKey) {
    throw new Error("moduleKey is required to install a module from URL");
  }

  this.logger.info("Installing module from URL", {
    clientId, moduleKey, source, marketplaceModuleId, name, version,
  });

  // Duplicate check — same semantics as installModuleZip.
  const existing = await this.db.getModuleByModuleKey(moduleKey);
  if (existing) {
    this.logger.info("Module already installed, skipping fetch", {
      clientId, moduleKey, moduleName: existing.name,
    });
    if (this.webhookClient) {
      await this.webhookClient.send(
        {
          type: "module.installed",
          moduleName: existing.name,
          version: existing.version,
          moduleKey,
          alreadyInstalled: true,
        },
        clientId || undefined,
      );
    }
    return { success: true, message: "Module already installed", alreadyInstalled: true };
  }

  // Fetch the archive server-side with timeout + size cap.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Api.MARKETPLACE_FETCH_TIMEOUT_MS);
  let archiveBytes: Buffer;
  try {
    const res = await fetch(downloadUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Marketplace fetch failed: ${res.status} ${res.statusText}`);
    }
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > Api.MARKETPLACE_MAX_BYTES) {
      throw new Error(`Marketplace archive exceeds size cap (${contentLength} > ${Api.MARKETPLACE_MAX_BYTES})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > Api.MARKETPLACE_MAX_BYTES) {
      throw new Error(`Marketplace archive exceeds size cap (${buf.byteLength} > ${Api.MARKETPLACE_MAX_BYTES})`);
    }
    archiveBytes = buf;
  } catch (err) {
    // Convert fetch failures into module.install_failed so the UI's
    // moduleKey-correlated subscription unsticks instead of hanging.
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error("Marketplace fetch failed", { clientId, moduleKey, message });
    if (this.webhookClient) {
      await this.webhookClient.send(
        {
          type: "module.install_failed",
          moduleName: name,
          version,
          moduleKey,
          error: `Failed to fetch marketplace archive: ${message}`,
        },
        clientId || undefined,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  // Hand to barkloader — same path as installModuleZip.
  const fileName = `${name}-${version}.zip`;
  const formData = new FormData();
  formData.append("file", new File([archiveBytes], fileName, { type: "application/zip" }));
  formData.append("client_id", clientId);
  formData.append("module_key", moduleKey);

  const response = await this.barkloaderRequest("/functions", { method: "POST", body: formData });
  const json = (await response.json()) as { message?: string };
  this.logger.info("Module from URL handed to barkloader", {
    clientId, moduleKey, fileName, message: json.message,
  });
  return { success: true, message: json.message ?? "Module uploaded" };
}
```

### Where it fits in the call graph

```
Convex                        ApiSession.installModuleFromUrl
   │  capnweb                       │  injects clientId
   ▼                                ▼
ApiGateway.authenticate    →    Api.installModuleFromUrl
                                    │
                                    ├─ db.getModuleByModuleKey(moduleKey)?
                                    │      └─ short-circuit + synthetic webhook
                                    │
                                    ├─ fetch(downloadUrl) ── 30s timeout, 50MB cap
                                    │
                                    └─ POST barkloader /functions ── existing path
                                            │
                                            ▼
                                       barkloader → db.module.installed.*
                                            │
                                            ▼
                                       NATS → webhookClient.send → Convex
```

## Configuration

No new engine env vars are required. The presigned URL carries its own auth; the engine only needs outbound network access to the marketplace's R2 origin (typically `*.r2.cloudflarestorage.com` or whatever CDN the operator's marketplace fronts the bucket with). Deployments running behind a strict egress policy must add the R2/CDN host to their allowlist.

The size cap (50 MB) and fetch timeout (30 s) are intentionally hard-coded as static class constants in v1. If operators need to tune them, promote to env vars (`MARKETPLACE_MAX_BYTES`, `MARKETPLACE_FETCH_TIMEOUT_MS`) in a follow-up — out of scope here.

## Error handling

| Failure point | Behavior |
|---------------|----------|
| `moduleKey` missing | Throw synchronously (`installModuleFromUrl: moduleKey is required`). UI surfaces verbatim — this is a contract violation by the caller. |
| `clientId` missing | Throw synchronously (`clientId is required to install a module`). Should never happen — ApiSession injects it. |
| `downloadUrl` returns non-2xx (e.g. expired presign → 403, marketplace down → 5xx) | `fetch` resolves but `res.ok === false`; engine throws and **emits `module.install_failed` with `moduleKey`** before re-throwing. UI's existing `transientEvents` subscription picks up the error. |
| `downloadUrl` fetch times out (>30s) | `AbortController` fires, fetch throws `AbortError`; engine emits `module.install_failed` then re-throws. |
| `Content-Length` exceeds 50 MB cap | Engine throws before downloading the body. Emits `module.install_failed`. |
| Downloaded body exceeds 50 MB cap (no/false `Content-Length`) | Engine throws after `arrayBuffer()` resolves. Emits `module.install_failed`. |
| Module already installed (duplicate `moduleKey`) | Short-circuit: skip fetch, emit synthetic `module.installed` with `alreadyInstalled: true`, return success. **Same semantics as `installModuleZip`.** |
| Barkloader returns non-2xx | Existing `barkloaderRequest` throws with status + body. The barkloader failure path already handles `module.install_failed` emission via NATS — no extra handling needed here. |
| Two concurrent installs for the same `moduleKey` | The duplicate check is best-effort (TOCTOU window between `getModuleByModuleKey` and barkloader insert). Barkloader is the authority — it's expected to handle key conflicts idempotently; second install hits the same `module.installed` row. |

The double-webhook for fetch failures (`engine emits module.install_failed` + engine then throws synchronously to the RPC caller) is intentional: the Convex action also catches RPC throws and emits its own error transient event. They share the same `moduleKey`, so the UI sees the *latter* one (transientEvents stores latest by correlationKey), but either alone is sufficient to unstick the install progress card.

## Testing

### Unit tests (engine repo)

New test file or new test cases in an existing `api.test.ts`-style file covering:

1. **Happy path** — mock `fetch` to return a small zip Buffer, mock `barkloaderRequest` to resolve `{ message: "uploaded" }`. Assert: `db.getModuleByModuleKey` called with the supplied key, `fetch` called with the supplied URL, FormData posted to `/functions` with `client_id` and `module_key`, return value matches `{ success: true, message: "uploaded" }`.
2. **Duplicate short-circuit** — mock `db.getModuleByModuleKey` to return an existing module. Assert: `fetch` not called, `barkloaderRequest` not called, synthetic `module.installed` webhook sent with `alreadyInstalled: true`.
3. **Marketplace fetch 403** — mock `fetch` to return `{ ok: false, status: 403 }`. Assert: throws, `module.install_failed` webhook emitted with the supplied `moduleKey` and `name`/`version` from `ctx`.
4. **Fetch timeout** — make `fetch` hang past 30 s using fake timers. Assert: `AbortController.abort()` fires, fetch rejects with `AbortError`, `module.install_failed` webhook emitted, RPC re-throws.
5. **Size cap (header)** — mock `fetch` to return `Content-Length: 999999999`. Assert: throws before reading body.
6. **Size cap (body)** — mock `fetch` to return an oversized `arrayBuffer()`. Assert: throws after read.
7. **Missing `moduleKey`** / **missing `clientId`** — assert validators throw synchronously.

Existing `installModuleZip` tests are the template; copy structure and swap the input shape. No network calls — `fetch` is mocked.

### Integration (manual)

Run UI dev server + engine dev server pointed at a marketplace mock that serves a known-good zip:

1. Browse tab loads; click a module; Install button enabled.
2. Engine logs show `Installing module from URL`, `Module from URL handed to barkloader`.
3. UI flips to `Installed` once `module.installed` webhook arrives.
4. Click Install again on the same module — engine logs show `Module already installed, skipping fetch`, UI sees the synthetic webhook and stays on Installed.
5. Manually expire the presign (or use a deliberately broken URL) — engine logs `Marketplace fetch failed`, UI shows "Install failed" with the marketplace error message verbatim.

### Out-of-scope (not in this spec)

- Verification of an end-to-end install across the public internet (deferred to deployment-time runbook).
- Marketplace mock harness for CI (write later if the unit-test mocks prove insufficient).

## File-level summary

| File | Repo | Change |
|------|------|--------|
| `shared/clients/typescript/api/api.ts` | `woofx3/shared` | Add `installModuleFromUrl` to `Woofx3EngineApi` interface |
| `api/src/api-session.ts` | `woofx3/api` | Add `installModuleFromUrl` override that injects `clientId` |
| `api/src/api.ts` | `woofx3/api` | Implement `installModuleFromUrl` near `installModuleZip` (~line 2774); add `MARKETPLACE_FETCH_TIMEOUT_MS` / `MARKETPLACE_MAX_BYTES` class constants |
| `api/src/api.test.ts` (or new file) | `woofx3/api` | Unit tests covering happy path, duplicate, fetch failure, timeout, size cap, validators |

## Coordination

This RPC is the engine half of the **marketplace browse** feature. The UI half (Convex action `marketplace.installModule`, sidebar Browse tab fetch, install button wiring) already ships independently — it will throw at runtime until this engine method exists. Order of operations:

1. **Engine PR** (this spec) — implement + tests + deploy to dev.
2. **UI dev verification** — exercise the Browse → Install flow against the new engine build with a marketplace mock.
3. **Marketplace API** — must conform to the contract in [`2026-05-17-marketplace-browse-design.md`](./2026-05-17-marketplace-browse-design.md), specifically `/modules/{id}/download` returning `{ url, expires_at }`.

The UI's Convex env var `MARKETPLACE_API_URL` and the engine's outbound network access to the marketplace's R2 origin are deployment prerequisites — track them in the rollout checklist.

## Future work (not in this spec)

- Signature/hash verification: have the marketplace include a SHA-256 in `/modules/{id}/download` and have the engine verify it before handing to barkloader.
- Store `source: "marketplace"` and `marketplaceModuleId` on the engine's `modules` table so the engine's own UI/API can render where a module came from (today only Convex knows).
- Promote size cap and timeout to env vars.
- Add an `installModuleFromUrl` variant that takes streaming `Headers` for non-presigned auth (Git host token, private registry creds) once we have a use case.
