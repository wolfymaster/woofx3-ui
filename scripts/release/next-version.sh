#!/usr/bin/env bash
#
# semantic-release's verifyRelease step (see .releaserc.json). It runs twice
# per desktop release: in the dry run, to hand the version and release type
# to the jobs that gate, build and sign the installer, and again when
# publishing, where the version must still be the one the installer was
# built and signed as. The updater signature is bound to the version, so a
# commit landing on master in between must stop the release, not ship an
# installer that reports another version than its tag.

set -euo pipefail

version="${1:?usage: next-version.sh <version> <type>}"
type="${2:?usage: next-version.sh <version> <type>}"

if [[ -n "${RELEASE_EXPECTED_VERSION:-}" && "$version" != "$RELEASE_EXPECTED_VERSION" ]]; then
    echo "semantic-release would publish ${version}, but the installer was built as ${RELEASE_EXPECTED_VERSION}" >&2
    exit 1
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
        echo "version=${version}"
        echo "type=${type}"
    } >> "$GITHUB_OUTPUT"
fi
