# Generic image for the TypeScript Node services (api, worker, migrate).
# MVP choice: run TypeScript via tsx in the container to keep the build trivial;
# a compiled multi-stage build is a Day-3 optimisation (docs/ARCHITECTURE.md §15).
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY services/worker/package.json services/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/github/package.json packages/github/
COPY packages/analyzer/package.json packages/analyzer/
COPY packages/ai/package.json packages/ai/
COPY tests/package.json tests/

# Install the whole workspace once so api, worker and migrate share identical cached layers
# (one image build instead of three); APP_FILTER only selects which package to start.
RUN pnpm install --frozen-lockfile --prod=false

COPY packages ./packages
COPY apps/api ./apps/api
COPY services/worker ./services/worker

RUN groupadd -g 10001 app && useradd -u 10001 -g app -m app && chown -R app:app /app
USER app
ARG APP_FILTER
ENV APP_FILTER=${APP_FILTER}
CMD ["sh", "-c", "pnpm --filter \"$APP_FILTER\" start"]
