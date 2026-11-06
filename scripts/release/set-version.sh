#!/usr/bin/env bash
#
# Writes a desktop version into the overlay the woofx3 build reads. The
# updater compares this version and the installer's signature is bound to
# it, so the release workflow writes it before building and semantic-release
# writes the same one into the release commit.

set -euo pipefail

version="${1:?usage: set-version.sh <version>}"
config="$(git rev-parse --show-toplevel)/companion/src-tauri/tauri.woofx3.conf.json"

semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
if [[ ! "$version" =~ $semver ]]; then
    echo "not a release version: ${version}" >&2
    exit 1
fi

# Only the top-level `"version"` line changes, so the file keeps its
# formatting; jq would rewrite all of it.
if [[ "$(grep -c '^  "version": "[^"]*",$' "$config")" != 1 ]]; then
    echo "${config} has no single top-level \"version\" line" >&2
    exit 1
fi
sed -i "s/^  \"version\": \"[^\"]*\",\$/  \"version\": \"${version}\",/" "$config"
test "$(jq -r '.version' "$config")" = "$version"
