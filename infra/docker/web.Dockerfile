FROM node:24-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY services/worker/package.json services/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/github/package.json packages/github/
COPY packages/analyzer/package.json packages/analyzer/
COPY packages/ai/package.json packages/ai/
COPY tests/package.json tests/
RUN pnpm install --frozen-lockfile --filter "@repopilot/web..." --prod=false
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @repopilot/web build

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd -g 10001 app && useradd -u 10001 -g app -m app
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
