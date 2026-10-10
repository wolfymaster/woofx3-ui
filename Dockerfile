# syntax=docker/dockerfile:1

# The production UI image: a static Vite build served by Caddy.
#
# The client imports the engine's shared type package (`@woofx3/api`) from a
# sibling woofx3 checkout, which lies outside this build context. It comes in
# as the named context `engine-api` and is placed at the same relative path
# (`../woofx3/shared/clients/typescript/api`) that vite.config.ts resolves.
#
#   docker build \
#     --build-context engine-api=../woofx3/shared/clients/typescript/api \
#     --build-arg VITE_CONVEX_URL=https://<deployment>.convex.cloud \
#     --build-arg VITE_CONVEX_SITE_URL=https://<deployment>.convex.site \
#     -t woofx3-ui .
#
# Without `--build-context engine-api=...` the build fails trying to pull an
# image called "engine-api".

ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION} AS build

WORKDIR /src/woofx3/shared/clients/typescript/api
COPY --from=engine-api package.json bun.lock ./
RUN bun install --frozen-lockfile
# The whole package, subdirectories included (the client imports
# `@woofx3/api/scene-editor/*`), minus tests and any node_modules the host
# installed into the context: the dependencies come from the install above.
COPY --from=engine-api --exclude=**/node_modules --exclude=**/*.test.ts . ./

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
RUN test -n "$VITE_CONVEX_URL" || { echo "VITE_CONVEX_URL build arg is required" >&2; exit 1; }; \
    test -n "$VITE_CONVEX_SITE_URL" || { echo "VITE_CONVEX_SITE_URL build arg is required" >&2; exit 1; }
RUN bun run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/woofx3-ui/dist /srv
