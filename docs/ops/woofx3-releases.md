# woofx3 releases

The woofx3 app is the [companion app](/ui/companion)'s code built with an engine bundled and an identity of its own (see [Two products](/ui/companion#two-products)). It is released from this repository as a signed Windows installer, separately from the companion: pushing a `woofx3-v<version>` tag runs `.github/workflows/woofx3-release.yml`, which builds, signs and publishes it, and installed woofx3 apps find the new version on their own and offer to restart into it.

Everything here mirrors [Companion releases](/ops/companion-releases); this page covers what differs.

| What | Where |
|------|-------|
| Installer, signature, `latest.json` | The GitHub release for the tag, e.g. `woofx3-v0.2.0` |
| What installed woofx3 apps read | `https://github.com/wolfymaster/woofx3-ui/releases/download/woofx3-latest/latest.json` |
| Identity, version and update feed | `companion/src-tauri/tauri.woofx3.conf.json` |
| The bundled engine | `companion/bundled-engine.json` |

## Cutting a release

1. Bump `version` in `companion/src-tauri/tauri.woofx3.conf.json`. Merge that to `master`.
2. Tag the merged commit and push the tag:

   ```bash
   git tag woofx3-v0.2.0
   git push origin woofx3-v0.2.0
   ```

The version must be semver and newer than the one installed woofx3 apps run, or they will not update to it.

### Versions

The woofx3 app and the companion version independently. The woofx3 app's version is the `version` in `tauri.woofx3.conf.json`, which overrides `tauri.conf.json`'s; that is the version the updater compares, the signature is bound to, and the app reports to Convex. `Cargo.toml`'s version belongs to the companion, whose release checks it against `tauri.conf.json`; a woofx3 release neither reads nor needs it, so bumping the woofx3 app never touches `Cargo.toml` or `Cargo.lock`.

### The bundled engine

Each woofx3 release ships the engine release pinned in `companion/bundled-engine.json`: a release tag and the sha256 of its `woofx3-<tag>-windows-amd64.zip`. To ship a newer engine, change both (`sha256sum` of the downloaded zip), check it with `bun run fetch-engine` in `companion/`, and merge that before tagging. CI's [woofx3 installer](/ops/companion-releases#woofx3-installer) job builds with the pin on every pull request that changes it.

## What happens

1. **Check**: the tag must be `woofx3-v<semver>`, and its version must equal `version` in `tauri.woofx3.conf.json`. A `tauri.woofx3.conf.json` without a `version` fails too, since the build would otherwise carry the companion's.
2. **Build**: on `windows-latest`, in the `production` environment, with `WOOFX3_CONVEX_URL` and `WOOFX3_CONVEX_SITE_URL` from the environment's `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`, like the companion. The pinned engine is downloaded and checked first, then `tauri-apps/tauri-action` builds with the `bundled-engine` feature and `--config src-tauri/tauri.woofx3.conf.json`, signs the NSIS installer, and creates the GitHub release with the installer, its `.sig` and `latest.json`. The job then checks the engine was bundled.
3. **Point `latest.json` at the release** and **publish** it to the `woofx3-latest` prerelease, exactly as the companion does with `companion-latest`, including refusing to move `woofx3-latest` back to an older version.

woofx3 releases queue behind each other (their own `concurrency` group). They never touch `companion-latest`, and companion releases never touch `woofx3-latest`, so the two can run at the same time.

## Signing

woofx3 releases are signed with the same updater key as the companion: the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets in the `production` environment, whose public half is `plugins.updater.pubkey` in `tauri.conf.json` (the desktop config inherits it). Both products are built by workflows in this repository from the same environment, so a separate key would sit next to the first and protect against nothing a leak of one would not expose; one key means one secret to back up. What keeps the products apart is the feed: each reads only its own `latest.json`.

[The signing key](/ops/companion-releases#the-signing-key) section applies as it stands: lose the key and neither product can update again.

## Secrets and variables

The same as the companion's, in the `production` GitHub Environment: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`. Nothing new is needed.

## Test installers

CI's [woofx3 installer](/ops/companion-releases#woofx3-installer) job builds an unsigned woofx3 installer for pull requests, like the companion installer job. It has the woofx3 app's identity, so it installs beside a companion, checks `woofx3-latest` for updates, and talks to the **dev** Convex deployment. Uninstall it before installing a real release.
