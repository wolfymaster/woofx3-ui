# woofx3 releases

The woofx3 app is the [companion app](/ui/companion)'s code built with an engine bundled and an identity of its own (see [Two products](/ui/companion#two-products)). It is released from this repository as a signed Windows installer, separately from the companion: `.github/workflows/woofx3-release.yml` versions it from the commits on `master`, builds, tests, signs and publishes it, and installed woofx3 apps find the new version on their own and offer to restart into it.

Signing and test installers work as in [Companion releases](/ops/companion-releases); this page covers the rest.

| What | Where |
|------|-------|
| Installer, signature, `latest.json`, release notes | The GitHub release for the tag, e.g. `woofx3-v0.2.0` |
| Every release's notes | `companion/CHANGELOG.md` |
| What installed woofx3 apps read | `https://github.com/wolfymaster/woofx3-ui/releases/download/woofx3-latest/latest.json` |
| Identity, version and update feed | `companion/src-tauri/tauri.woofx3.conf.json` |
| The bundled engine | `companion/bundled-engine.json` |

## Cutting a release

Releases are cut by `.github/workflows/woofx3-release.yml` from the commits on `master`; nobody bumps a version or pushes a tag by hand.

- **A push to `master`** releases when a desktop commit since the last release is a `feat` or a breaking change.
- **Fixes wait.** A push whose desktop commits since the last release are only `fix` or `perf` releases nothing; they go out with the next feature.
- **To release now**, run the workflow by hand (Actions → woofx3 release → Run workflow, or `gh workflow run woofx3-release.yml`). It releases whatever is pending, fixes included, and does nothing when nothing is.

Each run's summary says what it decided: nothing to release, a version pending until a feature or a manual run, or the version it released.

### Versions

The version comes from [conventional commits](https://www.conventionalcommits.org): since the last `woofx3-v*` tag, a breaking change or a `feat` bumps the minor version (while the app is below 1.0) and a `fix` or `perf` bumps the patch. Other types (`chore`, `docs`, `test`, `refactor`, `ci`) release nothing.

Only commits that change what the desktop app ships count: the companion (`companion/`), the dashboard it bundles (`client/`, `shared/`, `attached_assets/`) and the root build config and dependencies. `scripts/release/desktop-commits.mjs` lists them, and must grow with `vite.config.ts`'s aliases. A commit that changes only Convex, deploy config, docs or CI neither bumps the desktop version nor appears in its changelog, since it reaches users without a desktop release.

The woofx3 app's version is the `version` in `tauri.woofx3.conf.json`, which overrides `tauri.conf.json`'s; that is the version the updater compares, the signature is bound to, and the app reports to Convex. The release commit writes it, so the file always holds the last released version. `Cargo.toml`'s version belongs to the companion, so a woofx3 release never touches `Cargo.toml` or `Cargo.lock`.

### The changelog

`companion/CHANGELOG.md` gains each release's notes, generated from the same commits, and the GitHub release and the update feed's `notes` carry them too. A commit's subject is its changelog line, so write it for someone reading what changed.

### The bundled engine

Each woofx3 release ships the engine release pinned in `companion/bundled-engine.json`: a release tag and the sha256 of its `woofx3-<tag>-windows-amd64.zip`. To ship a newer engine, change both (`sha256sum` of the downloaded zip), check it with `bun run fetch-engine` in `companion/`, and merge that. Type the commit by what the engine brings users: `fix(desktop): bundle engine v1.2.3` for fixes, `feat(desktop): ...` when it adds something they will see.

CI's [woofx3 installer](/ops/companion-releases#woofx3-installer) job builds with the pin on every pull request that changes the companion, and starts the bundled engine the way the app does (`cargo run --example engine_smoke` in `companion/core`): with nothing set but what the app sets, on a fresh data directory and again over what that run wrote. A pin whose engine cannot start in the app fails there.

## What happens

1. **Plan**: a semantic-release dry run settles the next version and its type, and the run decides whether to release (see [Cutting a release](#cutting-a-release)).
2. **Build**: on `windows-latest`, in the `production` environment, at the pushed commit with the new version written into `tauri.woofx3.conf.json`. The pinned engine is downloaded and checked, started as the app starts it, and then `tauri build` builds the NSIS installer with the `bundled-engine` feature and `--config src-tauri/tauri.woofx3.conf.json`, signed with the updater key, with `WOOFX3_CONVEX_URL` and `WOOFX3_CONVEX_SITE_URL` from the environment's `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`.
3. **Tag and publish**: semantic-release commits `companion/CHANGELOG.md` and the version to `master` as `chore(release): woofx3-v<version> [skip ci]`, tags that commit, and creates the GitHub release with the notes, the installer and its `.sig`. The version must still be the one the installer was built as, or nothing is tagged. If `master` moved on meanwhile, the run releases nothing: after a push, the newer push's run releases these commits with its own; a manual run fails and asks to be run again.
4. **Update installed apps**: `latest.json`, with the release's notes and the installer's public download URL, is attached to the release and published to the `woofx3-latest` prerelease, which refuses to move back to an older version. Only now do installed apps see the release.

woofx3 releases queue behind each other (their own `concurrency` group). They never touch `companion-latest`, and companion releases never touch `woofx3-latest`, so the two can run at the same time.

## Signing

woofx3 releases are signed with the same updater key as the companion: the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets in the `production` environment, whose public half is `plugins.updater.pubkey` in `tauri.conf.json` (the desktop config inherits it). Both products are built by workflows in this repository from the same environment, so a separate key would sit next to the first and protect against nothing a leak of one would not expose; one key means one secret to back up. What keeps the products apart is the feed: each reads only its own `latest.json`.

[The signing key](/ops/companion-releases#the-signing-key) section applies as it stands: lose the key and neither product can update again.

## Secrets and variables

The same as the companion's, in the `production` GitHub Environment: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`. Nothing new is needed.

## Test installers

CI's [woofx3 installer](/ops/companion-releases#woofx3-installer) job builds an unsigned woofx3 installer for pull requests, like the companion installer job. It has the woofx3 app's identity, so it installs beside a companion, checks `woofx3-latest` for updates, and talks to the **dev** Convex deployment. Uninstall it before installing a real release.
