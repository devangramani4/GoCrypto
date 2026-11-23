# syntax=docker/dockerfile:1.7
# GoCrypto backend image: api, websocket, matching-engine, risk-engine, market-data, workers and the
# migration/seed CLI. One image, the service is chosen by the container command (see docker-compose.yml).
ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install -g pnpm@10.28.0 && pnpm --version
WORKDIR /app

# Workspace manifests only — keeps the dependency layers cacheable.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/trading-utils/package.json packages/trading-utils/
COPY packages/validation/package.json packages/validation/
COPY packages/server-core/package.json packages/server-core/
COPY database/package.json database/
COPY services/api/package.json services/api/
COPY services/websocket/package.json services/websocket/
COPY services/matching-engine/package.json services/matching-engine/
COPY services/risk-engine/package.json services/risk-engine/
COPY services/market-data/package.json services/market-data/
COPY services/workers/package.json services/workers/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter "@gocrypto/api..." --filter "@gocrypto/websocket..." --filter "@gocrypto/matching-engine..." \
      --filter "@gocrypto/risk-engine..." --filter "@gocrypto/market-data..." --filter "@gocrypto/workers..." \
      --filter "@gocrypto/database..."
COPY tsconfig.base.json tsup.node.ts ./
COPY packages/shared-types packages/shared-types
COPY packages/trading-utils packages/trading-utils
COPY packages/validation packages/validation
COPY packages/server-core packages/server-core
COPY database database
COPY services services
# Bundles inline the @gocrypto/* workspace packages; third-party modules stay in node_modules.
RUN pnpm --filter "./services/*" --filter "@gocrypto/database" run build

FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod \
      --filter "@gocrypto/api..." --filter "@gocrypto/websocket..." --filter "@gocrypto/matching-engine..." \
      --filter "@gocrypto/risk-engine..." --filter "@gocrypto/market-data..." --filter "@gocrypto/workers..." \
      --filter "@gocrypto/database..."

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    GOCRYPTO_SKIP_DOTENV=1 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node database/package.json database/
COPY --chown=node:node database/migrations database/migrations
COPY --from=build --chown=node:node /app/database/dist database/dist
COPY --from=build --chown=node:node /app/services/api/package.json /app/services/api/
COPY --from=build --chown=node:node /app/services/api/dist services/api/dist
COPY --from=build --chown=node:node /app/services/websocket/package.json services/websocket/
COPY --from=build --chown=node:node /app/services/websocket/dist services/websocket/dist
COPY --from=build --chown=node:node /app/services/matching-engine/package.json services/matching-engine/
COPY --from=build --chown=node:node /app/services/matching-engine/dist services/matching-engine/dist
COPY --from=build --chown=node:node /app/services/risk-engine/package.json services/risk-engine/
COPY --from=build --chown=node:node /app/services/risk-engine/dist services/risk-engine/dist
COPY --from=build --chown=node:node /app/services/market-data/package.json services/market-data/
COPY --from=build --chown=node:node /app/services/market-data/dist services/market-data/dist
COPY --from=build --chown=node:node /app/services/workers/package.json services/workers/
COPY --from=build --chown=node:node /app/services/workers/dist services/workers/dist
USER node
EXPOSE 4000 4001 9101 9102 9103 9104
# PID 1 signal handling comes from the orchestrator (compose `init: true`, Kubernetes, PM2); services shut down gracefully on SIGTERM.
CMD ["node", "services/api/dist/main.js"]
