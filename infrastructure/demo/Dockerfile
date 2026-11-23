# syntax=docker/dockerfile:1.7
# GoCrypto DEMO: the whole platform (MariaDB, Redis, every backend service, the web app and nginx) in
# ONE container, for free single-container hosts such as a Hugging Face Docker Space.
#
#   - SANDBOX trading only: simulated prices, simulated deposits and a sandbox market maker. No real
#     money or assets are ever involved.
#   - The database lives inside the container, so every account and order is wiped when the
#     container is recreated. Secrets are generated on first start.
#   - Not a production deployment: see docker-compose.yml and docs/DEPLOYMENT.md for that.
#
# Build from GitHub (what the Hugging Face Space does; GOCRYPTO_REF is a branch, tag or commit):
#   docker build -t gocrypto-demo infrastructure/demo
# Build from this working copy instead:
#   docker build -t gocrypto-demo -f infrastructure/demo/Dockerfile --build-arg GOCRYPTO_SOURCE=local .
# Run:
#   docker run --rm -p 7860:7860 gocrypto-demo        # then open http://localhost:7860
ARG NODE_VERSION=22-bookworm-slim
ARG UBUNTU_VERSION=24.04
ARG GOCRYPTO_SOURCE=git

FROM ubuntu:${UBUNTU_VERSION} AS source-git
ARG GOCRYPTO_REPO=https://github.com/devangramani4/GoCrypto.git
ARG GOCRYPTO_REF=claude/gocrypto-trading-platform-c7lzxy
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git init -q /src && cd /src \
 && git remote add origin "${GOCRYPTO_REPO}" \
 && git fetch -q --depth 1 origin "${GOCRYPTO_REF}" \
 && git checkout -q FETCH_HEAD \
 && rm -rf .git

FROM scratch AS source-local
COPY . /src

FROM source-${GOCRYPTO_SOURCE} AS source

# Compile the backend services, the database CLI and the web app.
FROM node:${NODE_VERSION} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install -g pnpm@10.28.0
WORKDIR /app
COPY --from=source /src /app
RUN pnpm install --frozen-lockfile \
      --filter "@gocrypto/api..." --filter "@gocrypto/websocket..." --filter "@gocrypto/matching-engine..." \
      --filter "@gocrypto/risk-engine..." --filter "@gocrypto/market-data..." --filter "@gocrypto/workers..." \
      --filter "@gocrypto/database..." --filter "@gocrypto/web..."
RUN pnpm --filter "./services/*" --filter "@gocrypto/database" run build \
 && pnpm --filter "@gocrypto/web" exec vite build

# Runtime dependencies of the backend bundles only.
FROM node:${NODE_VERSION} AS prod-deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install -g pnpm@10.28.0
WORKDIR /app
COPY --from=source /src/package.json /src/pnpm-lock.yaml /src/pnpm-workspace.yaml /src/.npmrc ./
COPY --from=source /src/packages/shared-types/package.json packages/shared-types/
COPY --from=source /src/packages/trading-utils/package.json packages/trading-utils/
COPY --from=source /src/packages/validation/package.json packages/validation/
COPY --from=source /src/packages/server-core/package.json packages/server-core/
COPY --from=source /src/database/package.json database/
COPY --from=source /src/services/api/package.json services/api/
COPY --from=source /src/services/websocket/package.json services/websocket/
COPY --from=source /src/services/matching-engine/package.json services/matching-engine/
COPY --from=source /src/services/risk-engine/package.json services/risk-engine/
COPY --from=source /src/services/market-data/package.json services/market-data/
COPY --from=source /src/services/workers/package.json services/workers/
RUN pnpm install --frozen-lockfile --prod \
      --filter "@gocrypto/api..." --filter "@gocrypto/websocket..." --filter "@gocrypto/matching-engine..." \
      --filter "@gocrypto/risk-engine..." --filter "@gocrypto/market-data..." --filter "@gocrypto/workers..." \
      --filter "@gocrypto/database..."

# Process manager for the runtime image.
FROM node:${NODE_VERSION} AS pm2
RUN npm install -g --prefix /opt/pm2 pm2@7.1.2 && npm cache clean --force

# Ubuntu LTS runtime: MariaDB 10.11, Redis 7 and nginx from the distribution, Node.js from the
# official image.
FROM node:${NODE_VERSION} AS node
FROM ubuntu:${UBUNTU_VERSION} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends mariadb-server redis-server nginx ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=pm2 /opt/pm2 /opt/pm2
ENV PATH=/opt/pm2/bin:$PATH \
    NODE_ENV=production \
    GOCRYPTO_SKIP_DOTENV=1 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=source /src/package.json ./
COPY --from=source /src/database/package.json database/
COPY --from=source /src/database/migrations database/migrations
COPY --from=build /app/database/dist database/dist
COPY --from=build /app/services/api/package.json services/api/
COPY --from=build /app/services/api/dist services/api/dist
COPY --from=build /app/services/websocket/package.json services/websocket/
COPY --from=build /app/services/websocket/dist services/websocket/dist
COPY --from=build /app/services/matching-engine/package.json services/matching-engine/
COPY --from=build /app/services/matching-engine/dist services/matching-engine/dist
COPY --from=build /app/services/risk-engine/package.json services/risk-engine/
COPY --from=build /app/services/risk-engine/dist services/risk-engine/dist
COPY --from=build /app/services/market-data/package.json services/market-data/
COPY --from=build /app/services/market-data/dist services/market-data/dist
COPY --from=build /app/services/workers/package.json services/workers/
COPY --from=build /app/services/workers/dist services/workers/dist
COPY --from=build /app/apps/web/dist web
COPY --from=source /src/infrastructure/demo infrastructure/demo
# Hugging Face runs Spaces as UID 1000, which is the image's "ubuntu" user.
USER 1000
EXPOSE 7860
CMD ["sh", "/app/infrastructure/demo/start.sh"]
