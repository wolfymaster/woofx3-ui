#!/usr/bin/env bash
# Creates, redeploys and removes a pull request's UI preview through the woofx3
# maintenance API, and keeps one sticky comment on the pull request saying
# where it is.
#
#   preview-ui.sh up <pr-number> <image-tag> [engine-version]
#   preview-ui.sh down <pr-number> [keep-engine]
#
# `up` serves ghcr.io/<repo>:<image-tag> at https://pr-<n>-woofx3-ui.<preview
# domain>. With an engine version it also pairs the preview with the preview
# engine running that release: the maintenance API reuses the engine when one
# is already up and creates it when not. Without one, the preview is unpaired.
# When it is paired, the engine's URL, release and registration token are
# written to $GITHUB_OUTPUT (the token masked) for the workflow to hand to the
# preview's Convex deployment.
#
# `down` removes the preview. The engine goes with it unless another UI
# preview still uses it, or `keep-engine` is "true".
#
# Environment:
#   MAINTENANCE_API_URL   base URL of the maintenance API (no trailing slash)
#   MAINTENANCE_API_KEY   wx3m_… key with previews:write, for owner type github
#   GH_TOKEN              token for the gh CLI, to write the comment
#   GITHUB_REPOSITORY     owner/repo (set by Actions)
#   GITHUB_OUTPUT         step outputs file (set by Actions)
#
# One UI preview per pull request, found by its owner reference
# (`<owner>/<repo>#<number>`), so a rerun redeploys rather than creating a
# second one, and `down` is a no-op when there is nothing left.
set -euo pipefail

MAINTENANCE_API_URL="${MAINTENANCE_API_URL:?MAINTENANCE_API_URL is required}"
MAINTENANCE_API_KEY="${MAINTENANCE_API_KEY:?MAINTENANCE_API_KEY is required}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
GITHUB_OUTPUT="${GITHUB_OUTPUT:-/dev/null}"

# Previews are throwaway: gone after this long without a push, even if the
# "closed" run never happens (the maintenance API's reaper deletes them).
TTL_HOURS="${TTL_HOURS:-72}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-15}"
# A new engine migrates its database and waits for its certificate, which can
# take a while on top of the UI's own deploy.
POLL_TIMEOUT_SECONDS="${POLL_TIMEOUT_SECONDS:-2400}"

# Marks this workflow's comment so it is updated instead of duplicated.
COMMENT_MARKER="<!-- woofx3:preview-ui -->"

usage="usage: preview-ui.sh up <pr-number> <image-tag> [engine-version] | down <pr-number> [keep-engine]"
command="${1:?$usage}"
pr_number="${2:?$usage}"
case "$pr_number" in
'' | *[!0-9]*)
  echo "pull request number must be digits, got: $pr_number" >&2
  exit 2
  ;;
esac
owner_ref="${GITHUB_REPOSITORY}#${pr_number}"
slug="pr-${pr_number}-woofx3-ui"

# api <method> <path> [body] [idempotency-key]
api() {
  local method="$1" path="$2" body="${3:-}" idempotency_key="${4:-}"
  local args=(--silent --show-error --fail-with-body
    --request "$method"
    --header "Authorization: Bearer ${MAINTENANCE_API_KEY}"
    --header "Content-Type: application/json")
  if [ -n "$idempotency_key" ]; then
    args+=(--header "Idempotency-Key: ${idempotency_key}")
  fi
  if [ -n "$body" ]; then
    args+=(--data "$body")
  fi
  curl "${args[@]}" "${MAINTENANCE_API_URL}${path}"
}

# The UI preview for this pull request, or "" when it has none. The owner's
# list also holds nothing else: shared engines are owned by their release.
find_preview_id() {
  api GET "/v1/engines?ownerType=github&ownerRef=$(jq --raw-output --null-input --arg ref "$owner_ref" '$ref|@uri')" |
    jq --raw-output '[(.engines // [])[] | select(.app == "ui")][0].id // ""'
}

comment() {
  local body="$1"
  local existing
  existing="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${pr_number}/comments" --paginate \
    --jq "map(select(.body | contains(\"${COMMENT_MARKER}\"))) | .[0].id // empty")"
  # --raw-field, not --field: the latter coerces values that look like numbers
  # or booleans, and a comment body is always a string.
  if [ -n "$existing" ]; then
    gh api --method PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${existing}" \
      --raw-field "body=${COMMENT_MARKER}"$'\n'"${body}" >/dev/null
  else
    gh api --method POST "repos/${GITHUB_REPOSITORY}/issues/${pr_number}/comments" \
      --raw-field "body=${COMMENT_MARKER}"$'\n'"${body}" >/dev/null
  fi
}

# Waits until the row's latest run has finished, so a redeploy is not refused
# as run_in_progress when an earlier workflow run was cancelled mid-wait.
# Prints the final detail document.
wait_until_settled() {
  local id="$1" deadline=$((SECONDS + POLL_TIMEOUT_SECONDS)) detail status
  while true; do
    detail="$(api GET "/v1/engines/${id}")"
    status="$(jq --raw-output '.run.status // "none"' <<<"$detail")"
    case "$status" in
    pending | running) ;;
    *)
      printf '%s' "$detail"
      return 0
      ;;
    esac
    if [ "$SECONDS" -ge "$deadline" ]; then
      printf '%s' "$detail"
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

# "<status> at <step>: <error>" for a detail document, for the comment.
describe_failure() {
  jq --raw-output '"`\(.engine.status)` at step `\(.run.currentStep // "unknown")`: \(.run.error.message // "no error reported")"' <<<"$1"
}

case "$command" in
up)
  image_tag="${3:?$usage}"
  engine_version="${4:-}"
  preview_id="$(find_preview_id)"

  if [ -z "$preview_id" ]; then
    echo "Creating UI preview ${slug} on ${image_tag}${engine_version:+ with engine ${engine_version}}"
    # Keyed on the pull request and tag, so two runs racing here create one
    # preview and both get its response.
    created="$(api POST "/v1/engines" "$(jq --null-input \
      --arg slug "$slug" \
      --arg ref "$owner_ref" \
      --arg version "$image_tag" \
      --arg engineVersion "$engine_version" \
      --argjson ttl "$TTL_HOURS" \
      '{slug: $slug, kind: "preview", app: "ui", owner: {type: "github", ref: $ref}, version: $version,
        ttlHours: $ttl} + (if $engineVersion == "" then {} else {engineVersion: $engineVersion} end)')" \
      "preview-ui:${owner_ref}:${image_tag}")"
    preview_id="$(jq --raw-output '.engine.id // ""' <<<"$created")"
  else
    if ! wait_until_settled "$preview_id" >/dev/null; then
      echo "preview-ui: an earlier run on ${preview_id} is still going" >&2
      exit 1
    fi
    echo "Redeploying UI preview ${preview_id} on ${image_tag}${engine_version:+ with engine ${engine_version}}"
    # engineVersion null unpairs: a preview whose pull request stopped naming
    # an engine should not keep one running.
    api POST "/v1/engines/${preview_id}/redeploy" "$(jq --null-input \
      --arg version "$image_tag" \
      --arg engineVersion "$engine_version" \
      '{version: $version, engineVersion: (if $engineVersion == "" then null else $engineVersion end)}')" >/dev/null
  fi

  if [ -z "$preview_id" ] || [ "$preview_id" = "null" ]; then
    comment "UI preview failed: the maintenance API returned no preview id."
    echo "preview-ui: no preview id returned" >&2
    exit 1
  fi

  comment "UI preview \`${slug}\` is building \`${image_tag}\`${engine_version:+ with engine \`${engine_version}\`}…"

  echo "Waiting for the UI preview (up to ${POLL_TIMEOUT_SECONDS}s)"
  settled=0
  preview="$(wait_until_settled "$preview_id")" || settled=$?
  ui_status="$(jq --raw-output '.engine.status' <<<"$preview")"
  ui_url="$(jq --raw-output '.engine.publicUrl // ""' <<<"$preview")"
  engine_id="$(jq --raw-output '.engine.pairedEngineId // ""' <<<"$preview")"

  engine_line=""
  engine_ok=1
  if [ -n "$engine_id" ]; then
    echo "Waiting for the paired engine ${engine_id}"
    engine="$(wait_until_settled "$engine_id")" || engine_ok=0
    engine_status="$(jq --raw-output '.engine.status' <<<"$engine")"
    if [ "$engine_status" = "ready" ]; then
      engine_url="$(jq --raw-output '.engine.publicUrl' <<<"$engine")"
      engine_release="$(jq --raw-output '.engine.desiredVersion' <<<"$engine")"
      token="$(api GET "/v1/engines/${engine_id}/registration-token" | jq --raw-output '.registrationToken')"
      echo "::add-mask::${token}"
      {
        echo "engine_url=${engine_url}"
        echo "engine_version=${engine_release}"
        echo "registration_token=${token}"
      } >>"$GITHUB_OUTPUT"
      engine_line="Engine: ${engine_url} (\`${engine_release}\`, shared with every preview on that release)"
    else
      engine_ok=0
      engine_line="Engine $(describe_failure "$engine")"
    fi
  else
    engine_line="No engine paired. Add \`engine-version: <release>\` to the pull request description to pair one."
  fi
  echo "ui_url=${ui_url}" >>"$GITHUB_OUTPUT"

  if [ "$ui_status" = "ready" ] && [ "$engine_ok" = 1 ]; then
    echo "UI preview ready at ${ui_url}"
    comment "UI preview ready: ${ui_url}

${engine_line}

Running \`${image_tag}\`. It is removed when this pull request closes, and expires ${TTL_HOURS} hours after the last push."
    exit 0
  fi

  if [ "$ui_status" = "ready" ]; then
    comment "UI preview is up at ${ui_url}, but its engine is not:

${engine_line}"
  elif [ "$settled" != 0 ]; then
    comment "UI preview did not finish within ${POLL_TIMEOUT_SECONDS}s: $(describe_failure "$preview")"
  else
    comment "UI preview failed: $(describe_failure "$preview")"
  fi
  echo "preview-ui: not ready (UI ${ui_status}; ${engine_line})" >&2
  exit 1
  ;;

down)
  keep_engine="${3:-false}"
  preview_id="$(find_preview_id)"
  if [ -z "$preview_id" ]; then
    echo "No UI preview for ${owner_ref}; nothing to remove"
    exit 0
  fi
  echo "Removing UI preview ${preview_id} (keep engine: ${keep_engine})"
  query=""
  if [ "$keep_engine" = "true" ]; then
    query="?keepPairedEngine=true"
  fi
  api DELETE "/v1/engines/${preview_id}${query}" >/dev/null
  if [ "$keep_engine" = "true" ]; then
    comment "UI preview removed. Its engine was kept."
  else
    comment "UI preview removed, with its engine unless another preview still uses it."
  fi
  ;;

*)
  echo "$usage" >&2
  exit 2
  ;;
esac
