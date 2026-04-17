#!/usr/bin/env bash
# link-sdk.sh — wire this repo's @woofx3/api import to a sibling
# woofx3 checkout so SDK changes surface here without re-publishing.
#
# Usage:
#   bash scripts/link-sdk.sh            # link against ../woofx3
#   bash scripts/link-sdk.sh --unlink   # revert to the installed/aliased version
#
# This script only matters once @woofx3/api is published to a registry
# and this repo installs it via `bun add @woofx3/api`. Today the repo
# resolves the SDK via tsconfig/vite path aliases pointing at the
# sibling checkout, so link/unlink is a no-op — the aliases already
# point at local source.

set -euo pipefail

cd "$(dirname "$0")/.."

SDK_DIR="${WOOFX3_SDK_DIR:-../woofx3/shared/clients/typescript/api}"

if [ "${1:-}" = "--unlink" ]; then
  if command -v bun >/dev/null 2>&1; then
    bun unlink @woofx3/api 2>/dev/null || true
    echo "Unlinked @woofx3/api. Run 'bun install' to restore the installed version."
  else
    echo "bun not on PATH. Nothing to do."
  fi
  exit 0
fi

if [ ! -d "$SDK_DIR" ]; then
  echo "Error: SDK directory not found at $SDK_DIR" >&2
  echo "Set WOOFX3_SDK_DIR to the path of shared/clients/typescript/api in your woofx3 checkout." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is not on PATH. Install from https://bun.sh first." >&2
  exit 1
fi

(cd "$SDK_DIR" && bun link)
bun link @woofx3/api

echo "Linked @woofx3/api -> $SDK_DIR"
echo "Edit that checkout to see changes immediately."
echo "Run 'bash scripts/link-sdk.sh --unlink' to restore the pinned version."
