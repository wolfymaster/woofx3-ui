# Companion releases

The [companion app](/ui/companion) is released from this repository as a signed Windows installer. Pushing a `companion-v<version>` tag runs `.github/workflows/companion-release.yml`, which builds, signs and publishes it; installed companions find the new version on their own and offer to restart into it.

| What | Where |
|------|-------|
| Installer, signature, `latest.json` | The GitHub release for the tag, e.g. `companion-v0.2.0` |
| What installed companions read | `https://github.com/wolfymaster/woofx3-ui/releases/download/companion-latest/latest.json` |

## Cutting a release

1. Bump the version in **both** `companion/src-tauri/tauri.conf.json` (`version`) and `companion/src-tauri/Cargo.toml` (`[package] version`), and run `cargo update --workspace` in `companion/src-tauri` so `Cargo.lock` follows (it changes nothing else). Merge that to `master`.
2. Tag the merged commit and push the tag:

   ```bash
   git tag companion-v0.2.0
   git push origin companion-v0.2.0
   ```

The version must be semver and must be newer than the one installed companions run, or they will not update to it.

## What happens

1. **Check**: the tag must be `companion-v<semver>`, and its version must equal both version fields above. Anything else fails before a build starts.
2. **Build**: on `windows-latest`, in the `production` environment, with `WOOFX3_CONVEX_URL` set from the environment's `VITE_CONVEX_URL`, so the companion talks to the same Convex deployment as the production UI. The job fails first thing if a signing secret or that variable is missing.
3. **Release**: `tauri-apps/tauri-action` builds the NSIS installer, signs it, and creates the GitHub release for the tag with the installer, its `.sig` and `latest.json`.
4. **Point `latest.json` at the release**: the action writes API asset URLs into `latest.json`. The workflow swaps each one for the asset's public download URL on the tagged release (`…/releases/download/companion-v0.2.0/…`), checks that the announced version is the tag's, and uploads the result to the release again.
5. **Publish**: the workflow creates the `companion-latest` prerelease if it does not exist and uploads that `latest.json` to it, replacing the previous one. Installed companions pick it up at their next check.

Releases run one at a time (a `concurrency` group), so two tags pushed together cannot race to write `companion-latest`. Publishing a version older than the one `companion-latest` already announces fails, so re-running an old release cannot roll the pointer back.

## Secrets and variables

These live in the `production` GitHub Environment (**Settings → Environments → production**), next to the deploy's.

| Name | Kind | Purpose |
|------|------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | secret | The updater signing key: the contents of the private key file made by `bunx tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | That key's password |
| `VITE_CONVEX_URL` | variable | Already set for the UI deploy. Compiled into the companion as `WOOFX3_CONVEX_URL` |

The public half of the key is `plugins.updater.pubkey` in `companion/src-tauri/tauri.conf.json`. A release signed with any other key is rejected by installed companions.

## Why `companion-latest`

The updater needs one fixed URL. GitHub's own `releases/latest` would be the obvious one, but it follows whichever release in this repository is marked latest, so any other release cut here would change, or break, what every installed companion updates to.

`companion-latest` is a prerelease, which GitHub never treats as the latest release, and only this workflow writes to it. It holds just `latest.json`; the installer stays on the versioned release that `latest.json` points at. Its tag points at whatever commit it was first created from and means nothing.

## How the updater checks

The companion checks 30 seconds after it starts and then every 6 hours, only while it is connected to Convex, and never in a debug build. A newer release is downloaded in the background and its signature verified before the companion offers it, in a banner in its window and as **Restart to update to {version}** in the tray menu. It never restarts on its own. A failed check or download is logged and tried again at the next interval.

The installer is per user (`installMode: currentUser`), so installing and updating need no administrator prompt, and the updater runs it in passive mode: a progress bar, no questions.

Signatures name the version they were signed for, and the companion requires that (`requireSignedVersion`). `latest.json` itself is not signed; without the check, anyone able to tamper with it could pair a new version number with an older signed installer and roll companions back. The Tauri CLI binds the version when it signs during `tauri build` (2.12.1 and later; `companion/package.json` requires at least that).

## The signing key

**Back up the private key and its password somewhere other than this repository's secrets.** GitHub secrets cannot be read back.

If the private key is lost, no new release can be signed with it, and every installed companion accepts only that key, so **installed companions can never update again**. Users would have to download and install a companion built with a new key by hand. Rotating to a new key on purpose works the same way: ship one last release, signed with the old key, whose `pubkey` is the new one, and only then switch the secret.

## Limits

- **No Windows code signing yet.** The installer has no Authenticode signature, so SmartScreen warns on download and on first run ("Windows protected your PC") until enough people have run it. The updater's signature is a separate thing and works regardless; an update the companion downloads itself does not normally get the warning, since it does not come through a browser.
- Windows x64 only.
- The release body is fixed text; write release notes on the GitHub release by hand if you want them.
