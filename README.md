# RepoPilot

AI-powered GitHub repository analysis and repair. Takes a GitHub URL, finds issues, proposes patches, verifies them in a Docker sandbox, and optionally opens a PR. Every claim of "fixed" is backed by an observed sandbox run; the system never lets the model assert verification results.

Design docs: [docs/PRD.md](docs/PRD.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/API.md](docs/API.md) · [docs/DATABASE.md](docs/DATABASE.md) · [docs/SECURITY.md](docs/SECURITY.md) · [docs/EVALUATION.md](docs/EVALUATION.md)

## Layout

```
apps/web         Next.js UI
apps/api         Express API (validation, persistence, enqueue)
services/worker  BullMQ worker (pipeline stages, Docker sandbox, model calls)
packages/shared  env validation, Zod schemas, errors, logger, DB, queue
packages/github  GitHub URL parsing, snapshot download, PR creation
packages/analyzer manifest, context selection, patch validation
packages/ai      Anthropic client, prompts, structured-output schemas
tests/           integration tests and fixtures
infra/           Dockerfiles, sandbox image
```

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm compose:infra          # postgres + redis
pnpm db:migrate
pnpm dev:api                # http://localhost:4000/health
pnpm dev:worker             # http://localhost:4001/health
pnpm dev:web                # http://localhost:3000
```

Create a run:

```bash
curl -s -X POST localhost:4000/api/v1/runs -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/expressjs/express"}'
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test                   # unit tests, no services needed
pnpm test:integration       # needs postgres + redis from compose
```
