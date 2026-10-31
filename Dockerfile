# syntax=docker/dockerfile:1

# The production UI image: a static Vite build served by Caddy.
#
# The client imports the engine's shared type package (`@woofx3/api`) and its
# composition package (`@woofx3/scene`) from a sibling woofx3 checkout, which
# lies outside this build context. The checkout comes in as the named context
# `engine` and is placed at `/src/woofx3`, where vite.config.ts resolves
# `../woofx3/shared/clients/typescript/...`.
#
# The engine is a bun workspace with one lockfile at its root, so dependencies
# are installed from that lockfile, filtered to the two packages the UI uses.
# bun needs every workspace member's package.json to be present, but only the
# sources of `api` and `scene` are copied in.
#
#   docker build \
#     --build-context engine=../woofx3 \
#     --build-arg VITE_CONVEX_URL=https://<deployment>.convex.cloud \
#     --build-arg VITE_CONVEX_SITE_URL=https://<deployment>.convex.site \
#     -t woofx3-ui .
#
# Without `--build-context engine=...` the build fails trying to pull an image
# named `engine`.

ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION} AS build

# Manifests first, so the install layer is reused until a dependency changes.
WORKDIR /src/woofx3
COPY --from=engine --parents --exclude=**/node_modules package.json bun.lock **/package.json ./
RUN bun install --frozen-lockfile --filter @woofx3/api --filter @woofx3/scene

# The api package whole, subdirectories included (the client imports
# `@woofx3/api/scene-editor/*`), and the scene package, minus tests and any
# node_modules the host installed into the context: the dependencies come from
# the install above.
COPY --from=engine --parents --exclude=**/node_modules --exclude=**/*.test.ts --exclude=shared/clients/typescript/scene/tests shared/clients/typescript/api shared/clients/typescript/scene ./

WORKDIR /src/woofx3-ui
# postinstall runs ensure-engine-path.mjs, which checks ../woofx3 is in place.
COPY package.json bun.lockb ./
COPY scripts/ensure-engine-path.mjs scripts/
RUN bun install --frozen-lockfile
COPY . .

# Vite inlines these into the bundle, so they are fixed per image. A missing
# value would ship a client pointing at "undefined", so refuse to build.
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
# Optional: without it, forms on user pages are closed to anonymous visitors.
ARG VITE_TURNSTILE_SITE_KEY
RUN test -n "$VITE_CONVEX_URL" || { echo "VITE_CONVEX_URL build arg is required" >&2; exit 1; }; \
    test -n "$VITE_CONVEX_SITE_URL" || { echo "VITE_CONVEX_SITE_URL build arg is required" >&2; exit 1; }
RUN bun run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/woofx3-ui/dist /srv
