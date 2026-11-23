# syntax=docker/dockerfile:1.7
# Static SPA image for the trading web app (APP=web) or the admin panel (APP=admin), served by nginx.
ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS build
ARG APP=web
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install -g pnpm@10.28.0 && pnpm --version
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/trading-utils/package.json packages/trading-utils/
COPY packages/validation/package.json packages/validation/
COPY packages/api-client/package.json packages/api-client/
COPY packages/ui/package.json packages/ui/
COPY apps/${APP}/package.json apps/${APP}/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter "@gocrypto/${APP}..."
COPY tsconfig.base.json ./
COPY packages/shared-types packages/shared-types
COPY packages/trading-utils packages/trading-utils
COPY packages/validation packages/validation
COPY packages/api-client packages/api-client
COPY packages/ui packages/ui
COPY apps/${APP} apps/${APP}
# Type checking runs in CI; the image build only bundles.
RUN pnpm --filter "@gocrypto/${APP}" exec vite build

FROM nginx:1.27-alpine AS runtime
ARG APP=web
COPY infrastructure/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/${APP}/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
