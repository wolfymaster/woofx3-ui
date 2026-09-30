#!/usr/bin/env bash
# Points a Railway service at a container image, deploys it, and waits for the
# deployment to finish. Exits non-zero unless the deployment reaches SUCCESS,
# so a broken deploy fails the caller instead of going quietly live.
#
# Required environment:
#   RAILWAY_TOKEN           project token for the target project and environment
#   RAILWAY_ENVIRONMENT_ID  environment that holds the service
#   RAILWAY_SERVICE_ID      service to deploy
#   IMAGE                   image reference, e.g. ghcr.io/owner/repo:<sha>
# Optional:
#   RAILWAY_DEPLOY_TIMEOUT_SECONDS  how long to wait for a result (default 900)

# The `$name`s inside single-quoted queries are GraphQL variables, not shell ones.
# shellcheck disable=SC2016

set -euo pipefail

: "${RAILWAY_TOKEN:?RAILWAY_TOKEN is required}"
: "${RAILWAY_ENVIRONMENT_ID:?RAILWAY_ENVIRONMENT_ID is required}"
: "${RAILWAY_SERVICE_ID:?RAILWAY_SERVICE_ID is required}"
: "${IMAGE:?IMAGE is required}"
timeout_seconds="${RAILWAY_DEPLOY_TIMEOUT_SECONDS:-900}"
poll_seconds=10

endpoint="https://backboard.railway.com/graphql/v2"

# Prints the response body. Fails on HTTP errors and on GraphQL errors, which
# Railway returns with a 200 status.
gql() {
  local query=$1
  local variables=$2
  local response
  response=$(curl --silent --show-error --fail-with-body --retry 3 \
    --header "Project-Access-Token: ${RAILWAY_TOKEN}" \
    --header "Content-Type: application/json" \
    --data "$(jq --null-input --arg query "$query" --argjson variables "$variables" \
      '{query: $query, variables: $variables}')" \
    "$endpoint")
  if jq --exit-status '(.errors // []) | length > 0' <<<"$response" >/dev/null; then
    echo "Railway API error: $(jq --compact-output '.errors' <<<"$response")" >&2
    return 1
  fi
  printf '%s' "$response"
}

ids=$(jq --null-input \
  --arg serviceId "$RAILWAY_SERVICE_ID" \
  --arg environmentId "$RAILWAY_ENVIRONMENT_ID" \
  '{serviceId: $serviceId, environmentId: $environmentId}')

echo "Setting service image to ${IMAGE}"
gql 'mutation ($serviceId: String!, $environmentId: String!, $image: String!) {
  serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: { source: { image: $image } })
}' "$(jq --arg image "$IMAGE" '. + {image: $image}' <<<"$ids")" >/dev/null

deployment_id=$(gql 'mutation ($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
}' "$ids" | jq --raw-output '.data.serviceInstanceDeployV2')
if [[ -z "$deployment_id" || "$deployment_id" == "null" ]]; then
  echo "Railway did not return a deployment id" >&2
  exit 1
fi
echo "Started deployment ${deployment_id}"

deadline=$((SECONDS + timeout_seconds))
last_status=""
while ((SECONDS < deadline)); do
  status=$(gql 'query ($id: String!) { deployment(id: $id) { status } }' \
    "$(jq --null-input --arg id "$deployment_id" '{id: $id}')" |
    jq --raw-output '.data.deployment.status')
  if [[ "$status" != "$last_status" ]]; then
    echo "Deployment status: ${status}"
    last_status=$status
  fi
  case "$status" in
    SUCCESS)
      exit 0
      ;;
    FAILED | CRASHED | REMOVED | REMOVING | SKIPPED)
      echo "Deployment ${deployment_id} ended as ${status}; check its logs in Railway" >&2
      exit 1
      ;;
    NEEDS_APPROVAL)
      echo "Deployment ${deployment_id} is waiting for approval in Railway" >&2
      exit 1
      ;;
  esac
  sleep "$poll_seconds"
done

echo "Deployment ${deployment_id} did not finish within ${timeout_seconds}s (last status: ${last_status})" >&2
exit 1
