#!/usr/bin/env bash
#
# Runs the CI checks (.github/workflows/ci.yml) that a change touches and prints
# one line per check. A failure also prints the tail of its log.
#
#   check.sh            checks for what changed against master
#   check.sh --all      every check, including companion/core
#   check.sh --quick    lint and type-check only; skip tests and the build
#
# The web checks (lint, type checks, tests, build) run for any change outside
# companion/ and docs/. companion/core runs its cargo checks when it changed.
# companion/src-tauri is not checked here: CI builds it on Windows, and on
# Linux it needs GTK and WebKitGTK.
#
# Logs go to logs/check/<check>.log. Exit status is non-zero if any check
# failed.

set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

quick=false
all=false
for arg in "$@"; do
  case "$arg" in
    --quick) quick=true ;;
    --all) all=true ;;
    -h | --help)
      sed -n '4,8p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "check: unknown option $arg" >&2
      exit 2
      ;;
  esac
done

web=false
companion_core=false
if $all; then
  web=true
  companion_core=true
else
  base="$(git merge-base HEAD master 2>/dev/null || echo HEAD)"
  mapfile -t changed < <({
    git diff --name-only "$base"
    git ls-files --others --exclude-standard
  } | sort -u)
  if [ ${#changed[@]} -eq 0 ]; then
    echo "check: nothing changed against master; pass --all to check everything"
    exit 0
  fi
  for path in "${changed[@]}"; do
    case "$path" in
      companion/core/*) companion_core=true ;;
      companion/* | docs/*) ;;
      *) web=true ;;
    esac
  done
fi

readonly LOG_DIR="logs/check"
mkdir -p "$LOG_DIR"
failures=0

run_check() {
  local name="$1"
  shift
  local log="$LOG_DIR/$name.log"
  local started=$SECONDS
  if "$@" >"$log" 2>&1; then
    printf 'PASS  %-16s %4ss\n' "$name" "$((SECONDS - started))"
  else
    printf 'FAIL  %-16s %4ss  log: %s\n' "$name" "$((SECONDS - started))" "$log"
    tail -n 40 "$log" | sed 's/^/      /'
    failures=$((failures + 1))
  fi
}

# The engine's API client is imported from ../woofx3 at type-check and test
# time, and it needs its own node_modules (capnweb).
ensure_deps() {
  local engine_api="../woofx3/shared/clients/typescript/api"
  if [ ! -d node_modules ] || [ bun.lockb -nt node_modules ]; then
    bun install --frozen-lockfile || return 1
  fi
  if [ ! -d "$engine_api/node_modules" ]; then
    (cd "$engine_api" && bun install --frozen-lockfile) || return 1
  fi
}

if $web; then
  run_check deps ensure_deps
  run_check lint bunx biome ci .
  run_check check bun run check
  run_check check-convex bun run check:convex
  if ! $quick; then
    run_check test bun test
    run_check build bun run build
  fi
fi

if $companion_core; then
  core="companion/core/Cargo.toml"
  run_check core-fmt cargo fmt --manifest-path "$core" --check
  if ! $quick; then
    run_check core-clippy cargo clippy --manifest-path "$core" --all-targets -- -D warnings
    run_check core-test cargo test --manifest-path "$core"
  fi
fi

if ! $web && ! $companion_core; then
  echo "check: only docs/ or companion/src-tauri changed; nothing to check here"
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
