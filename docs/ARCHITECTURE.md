# RepoPilot — System Architecture

Status: Draft v0.1 (Day 1). Companion docs: PRD.md, API.md, DATABASE.md, SECURITY.md, EVALUATION.md.

## 1. Architectural principles

1. **Modular monolith, not microservices.** One repository, three deployable
   processes (web, api, worker) sharing typed packages. Process boundaries
   exist only where runtime requirements differ (HTTP vs. long-running jobs
   vs. Docker access).
2. **Repository code is hostile input.** It is never executed on the host, never
   sees application secrets, and is only executed inside a constrained container.
3. **AI output is untrusted data.** Every model response is parsed against a
   Zod schema; anything that fails is rejected, not "best-effort" repaired.
4. **Inference and observation are different types.** Records produced by the
   model carry `source = 'ai_inference'`; records produced by the sandbox carry
   `source = 'observed'`. The schemas for AI output contain no field in which a
   test result could be expressed, so the model *cannot* fabricate verification.
5. **Every stage is idempotent and resumable.** State lives in PostgreSQL; the
   queue only carries `run_id` + stage name.

## 2. Component overview

```
                ┌───────────────────────────────────────────────────────────┐
                │                       Host (Linux + Docker)                │
                │                                                           │
 Browser ──────►│  apps/web (Next.js)  ──HTTP──►  apps/api (Express)         │
                │                                    │      │                │
                │                                    │      └──► PostgreSQL  │
                │                                    ▼                       │
                │                              Redis (BullMQ)               │
                │                                    ▲                       │
                │                                    │                       │
                │                          services/worker (Node)           │
                │                             │   │   │                      │
                │            Anthropic API ◄──┘   │   └──► GitHub API        │
                │                                 ▼                          │
                │                      Docker Engine (socket)                │
                │                          ┌─────────────────┐              │
                │                          │ sandbox container│ (per run,    │
                │                          │ no secrets,      │  no network  │
                │                          │ non-root, capped)│  in test     │
                │                          └─────────────────┘  phase)      │
                └───────────────────────────────────────────────────────────┘
```

### 2.1 Packages and responsibilities

| Path | Type | Responsibility | Must NOT |
|---|---|---|---|
| `apps/web` | Next.js app | Submit runs, poll status, render issues/patches/evidence | Talk to DB/Redis directly; hold secrets other than API base URL |
| `apps/api` | Express server | Validate requests (Zod), persist runs, enqueue jobs, serve results, health | Execute pipeline stages; access Docker |
| `services/worker` | BullMQ worker | Execute pipeline stages; owns Docker socket, Anthropic key, GitHub App key | Serve HTTP (other than `/health`) |
| `packages/shared` | Library | Env validation, Zod domain schemas, error types, logger, DB client, queue names, ids | Depend on any app |
| `packages/github` | Library | URL parsing, snapshot (tarball) download, safe extraction, GitHub App auth, PR creation via Git Data API | Shell out to `git` |
| `packages/analyzer` | Library | Manifest builder, ecosystem detection, context selection, patch parsing/validation, test-output parsing | Call the model or Docker |
| `packages/ai` | Library | Anthropic client factory, prompt templates, structured-output schemas, token accounting | Persist to DB; know about Docker |
| `tests/` | Fixtures + integration | Fixture repositories with known bugs, integration and evaluation harness | — |

**Decision: modular monolith in a pnpm workspace.**
- *Why*: shared types across web/api/worker with zero network hops; one lockfile; one CI pipeline.
- *Alternative*: separate services per stage (ingestion service, analysis service, sandbox service).
- *Rejected because*: stages are sequential and small; the cost of inter-service contracts, deployment and tracing dwarfs any scaling benefit at MVP volume.
- *Tradeoff*: worker must be deployed with Docker access, so the worker host is the most privileged box. Accepted; documented in SECURITY.md.

**Decision: separate `api` and `worker` processes from day one.**
- *Why*: the API must respond in milliseconds and must not hold the Docker socket; the worker runs minutes-long jobs and needs it.
- *Alternative*: run BullMQ workers inside the Express process.
- *Rejected because*: a busy sandbox stage would starve HTTP handlers and put the Docker socket in the internet-facing process.
- *Tradeoff*: two processes to deploy and monitor. Compose handles it.

## 3. Data flow (one run)

1. `POST /api/v1/runs` → Zod validates body → `runs` row (`status=queued`, `stage=ingest`) → job `{runId}` enqueued on `pipeline` queue → `202 {runId}`.
2. Worker picks up job, loads run, executes **stage handler** for `run.stage`.
3. Each stage handler: reads inputs from PostgreSQL, does work, writes outputs to PostgreSQL in a transaction, appends `run_events`, advances `run.stage`, and enqueues the next stage job. Handlers are idempotent: re-running a completed stage is a no-op keyed by `(run_id, stage)`.
4. The `sandbox` stages are enqueued on a **separate queue** with lower concurrency.
5. Terminal states: `completed`, `failed` (with `error_code`), `cancelled`.
6. `GET /api/v1/runs/:id` reads state; the web app polls (SSE later).

### Stage list

| # | Stage | Queue | Inputs | Outputs | Idempotency key |
|---|---|---|---|---|---|
| 1 | `ingest` | pipeline | repo URL, ref | `repository_snapshots` row, extracted workspace on disk | snapshot exists for run |
| 2 | `manifest` | pipeline | workspace | `manifest` JSON on snapshot | manifest non-null |
| 3 | `select_context` | pipeline | manifest | `context_bundles` row (file list + token estimate) | bundle exists |
| 4 | `analyze` | pipeline | context bundle | `issues` rows (`source=ai_inference`), `ai_calls` row | issues exist or `analyze_done` event |
| 5 | `generate_patches` | pipeline | issues + context | `patches` rows (`status=proposed`) | one patch per issue |
| 6 | `validate_patches` | pipeline | patches | patch `status=validated|rejected` + `validation` JSON | all patches non-proposed |
| 7 | `generate_tests` | pipeline | validated patches | `generated_tests` rows | one per validated patch |
| 8 | `verify_baseline` | sandbox | workspace | `verification_runs` (`kind=baseline`, `source=observed`) | baseline row exists |
| 9 | `verify_patches` | sandbox | validated patches + tests | `verification_runs` (`kind=patched`) per patch | row per patch |
| 10 | `finalize` | pipeline | all above | `run.status=completed`, per-patch `outcome` | status terminal |
| — | `create_pr` | pipeline | user request, patch id | `pull_requests` row | PR row exists for patch |

## 4. Queue / job architecture

**Decision: BullMQ with two queues (`pipeline`, `sandbox`) and one job per stage, chained.**
- *Why*: per-stage retries and backoff; a failure in `analyze` does not redo `ingest`; sandbox concurrency (CPU/memory heavy) is tuned independently from I/O-bound stages.
- *Alternative A*: one long job that runs all stages in a loop.
  - *Rejected*: a crash mid-way retries the whole pipeline, re-downloading and re-paying for model calls; job duration would exceed sensible lock/stall timeouts.
- *Alternative B*: BullMQ Flows (parent/child trees).
  - *Rejected for MVP*: flows shine for fan-out/fan-in; our pipeline is linear. Per-patch verification is a small fan-out we handle with a loop inside the stage; revisit if per-patch parallelism is needed.
- *Alternative C*: a database-backed queue (e.g. `SELECT ... FOR UPDATE SKIP LOCKED`).
  - *Rejected*: viable, but BullMQ gives delayed retries, stall detection, rate limiting and a UI for free. Redis is already justified for caching model context bundles.
- *Tradeoff*: Redis becomes a hard dependency; job payloads must be tiny (`{runId, stage}` only) so PostgreSQL remains the source of truth.

Job options:
- `attempts: 3`, exponential backoff starting 5 s for stages 1–7 and `create_pr`.
- `attempts: 1` for `verify_*`: a failing test is a *result*, not an error. Infra errors (Docker daemon unreachable) are re-thrown as `retryable` and re-enqueued explicitly with a cap of 2.
- `removeOnComplete: {count: 1000}`, `removeOnFail: {count: 5000}`.
- Job id = `${runId}__${stage}` so duplicate enqueues collapse (BullMQ forbids `:` in custom ids).
- Worker concurrency: `pipeline` = 5, `sandbox` = 2 (configurable).
- Stall/lock: `lockDuration` 60 s for pipeline, 20 min for sandbox with `extendLock` on heartbeat.

Cancellation: API sets `runs.status = cancelling`; stage handlers check the flag between steps; sandbox handler kills the container. Final state `cancelled`.

## 5. Repository ingestion design

**Decision: download the GitHub tarball for the resolved commit SHA and extract it with a hardened extractor. Never run `git`.**
- *Why*: a tarball is inert data. Extraction can be bounded (file count, total bytes, per-file bytes, path traversal, symlinks/hardlinks rejected, device files rejected). No hooks, no submodule fetch, no `.git/config` surprises.
- *Alternative A*: `git clone --depth 1`.
  - *Rejected*: needs a git binary and credentials on the host; clone touches `.git` internals that are attacker-controlled (e.g. `core.fsmonitor`, hooks on later operations); submodules can point anywhere.
- *Alternative B*: GitHub Contents/Trees API file-by-file.
  - *Rejected*: hundreds of API calls per repo, rate-limit pressure, slow.
- *Tradeoff*: no commit history available to the analyzer (fine for MVP; could add via API later). Tarball download requires a token for private repos.

Steps:
1. Parse URL → `{owner, repo, ref?}` (strict regex, reject anything but `github.com`).
2. `GET /repos/{owner}/{repo}` → default branch, size, visibility. Reject archived/oversized repos early.
3. Resolve `ref` → commit SHA via `GET /repos/{owner}/{repo}/commits/{ref}`.
4. Stream `GET /repos/{owner}/{repo}/tarball/{sha}` to `WORKSPACE_ROOT/{runId}/src/`, enforcing limits during extraction. Abort and mark `REPO_TOO_LARGE` on breach.
5. Write `repository_snapshots` row with `commit_sha`, `file_count`, `total_bytes`.

Workspace layout on the worker host (bind-mounted into the sandbox):
```
WORKSPACE_ROOT/{runId}/
  src/        # pristine snapshot (read-only mount)
  patched/{patchId}/   # copy of src with patch + generated test applied
  out/        # sandbox writes JUnit/JSON results here (tmpfs-sized)
```
Workspaces are deleted after `finalize` unless `KEEP_WORKSPACES=true`.

### Manifest
Built by `packages/analyzer/manifest.ts`, pure function over the extracted tree:
- per file: `path, bytes, language, sha256, isTest, isConfig, isGenerated, isBinary, lineCount`
- ecosystem: `packageManager (npm|pnpm|yarn), nodeVersionHint, scripts, workspaces?, testRunner (vitest|jest|mocha|node:test|unknown), typescript: boolean`
- entry points from `package.json` (`main`, `exports`, `bin`), `tsconfig` roots.
- import graph (TS/JS only) via a lightweight regex/AST scan, stored as adjacency list capped at 20k edges.

## 6. AI context selection design

**Decision: deterministic, explainable heuristic ranking under a token budget; no embeddings in MVP.**
- *Why*: reproducible (same snapshot → same bundle), zero extra infrastructure, easy to evaluate offline, easy to debug ("why was this file included?").
- *Alternative A*: embeddings + vector store.
  - *Rejected for MVP*: another datastore, embedding cost per run, and for whole-repo bug finding the question ("what is wrong?") has no query to embed.
- *Alternative B*: send the whole repository (1M-token context).
  - *Rejected*: cost is proportional to repo size and unbounded; quality degrades with irrelevant content; still fails on >1M-token repos.
- *Alternative C*: let the model request files via tool use (agentic exploration).
  - *Deferred*: valuable, but non-deterministic and harder to cap. Planned as an optional second pass in a later iteration, still bounded by the same budget.
- *Tradeoff*: heuristics miss files that only a semantic view would catch. Mitigated by including the full manifest (paths only) so the model sees what exists.

Scoring signals (weights configurable, all in `packages/analyzer/context.ts`):
- +entry points and files reachable within 2 hops of them in the import graph
- +files with high fan-in (imported by many)
- +recently failing test targets (from baseline run, when available in a second pass)
- +`package.json`, `tsconfig*.json`, test config
- −generated/vendored/minified/lockfiles/binary (excluded outright)
- −tests (included as excerpts only, not full)
- size normalisation: prefer many medium files over one huge file

Budget: default 150k tokens of file content; measured with the Anthropic
`count_tokens` endpoint on the assembled bundle (fallback: bytes/3.5 estimate).
Bundle is stored as `context_bundles` (paths + ranges + token count), never as
copied content, so it is reproducible from the snapshot.

## 7. AI analysis and patch-generation design

**Decision: Anthropic Messages API with structured outputs (`output_config.format` from Zod via `zodOutputFormat`), one call per stage, streaming, adaptive thinking, hard token caps.**
- *Why*: structured outputs give schema-conformant JSON; the same Zod schema drives runtime validation and TypeScript types; streaming avoids HTTP timeouts on large inputs.
- *Alternative A*: free-text prompt + regex extraction.
  - *Rejected*: brittle; violates "AI output must be validated with deterministic schemas".
- *Alternative B*: tool-use loop where the model edits files directly.
  - *Rejected for MVP*: harder to cap and audit; we want a reviewable diff as the artefact, not a mutated tree.
- *Tradeoff*: one-shot generation may miss cross-file fixes. Mitigated by allowing multi-file diffs in the patch schema.

Model policy: default `claude-opus-5-5` for analysis and patches, effort `high`;
`claude-haiku-4-5` permitted for cheap classification (e.g. "is this file a test?") if needed. Model id is config, never hard-coded in stage logic. Every call writes an `ai_calls` row (model, input/output tokens, cache reads, latency, `schema_valid`, `stop_reason`). Refusal stop reasons are recorded and the stage fails with `AI_REFUSED`.

Schemas (packages/ai/schemas.ts, shared with DB rows):
- `AnalysisOutput = { issues: Issue[] }` where `Issue` has `title, category, severity, confidence (0–1), file, lineStart, lineEnd, explanation, evidence`. **No** field for "fixed", "tests pass", or any runtime claim.
- `PatchOutput = { patches: [{ issueRef, rationale, unifiedDiff, filesTouched[] }] }`.
- `TestOutput = { tests: [{ patchRef, path, content, framework }] }`.

If parsing fails (`parsed_output === null`) the stage retries once with the validation error appended; a second failure fails the stage with `AI_SCHEMA_INVALID`. The model is **never** asked to produce a verification verdict; the `verification_runs` table has a `CHECK (source = 'observed')` constraint.

### Patch validation (deterministic, host-side, no execution)
1. Parse unified diff; reject on parse error.
2. Every target path must exist in the manifest (or be a new file under an allowed directory), be a regular file, not a symlink, not binary, not in the denylist (`.github/**`, `*.yml` CI files, `Dockerfile*`, `package.json` `scripts` changes, lockfiles, `.npmrc`, `.env*`).
3. Size caps: ≤ 20 files, ≤ 2,000 changed lines per patch.
4. Apply with a pure-JS patch applier onto `patched/{patchId}` copy (data transformation only; no process spawn). Reject if any hunk fails.
5. Re-run the manifest builder on the patched tree to confirm no new binaries/symlinks appeared.
6. Result stored in `patches.validation` and `status` set to `validated` or `rejected` with reasons.

## 8. Docker sandbox design

**Decision: one ephemeral container per verification run, from a pinned RepoPilot-owned image, driven by `dockerode` from the worker, with strict resource limits and a two-phase network policy.**
- *Why*: containers are the isolation primitive already required by the stack; a pinned image makes results reproducible; `dockerode` avoids shelling out and string-building commands.
- *Alternative A*: run tests on the host with `child_process` under a low-privilege user.
  - *Rejected*: violates the hard rule; `npm install` alone runs arbitrary lifecycle scripts.
- *Alternative B*: gVisor / Firecracker microVMs.
  - *Deferred*: stronger isolation, but extra infrastructure. The runner interface is abstracted so `runtime: 'docker' | 'gvisor'` can be added; production hardening path documented in SECURITY.md.
- *Alternative C*: a persistent warm container reused across runs.
  - *Rejected*: cross-run contamination and a persistence foothold for malicious code.
- *Tradeoff*: `npm install` needs network. We accept network **only** in the install phase, with no secrets mounted and an egress allowlist enforced at the host firewall where available; the test phase runs with `--network none`.

Container spec (see `services/worker/src/sandbox/`):
- Image: `repopilot/sandbox-node:22` (built from `infra/sandbox/Dockerfile`, pinned by digest in config).
- User: `1000:1000` (non-root). `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only` rootfs with tmpfs `/tmp` and `/home/sandbox/.npm`.
- Mounts: `patched/{patchId}` → `/workspace` (rw, copy owned by uid 1000), `out/` → `/out` (rw, size-capped). No Docker socket, no host env.
- Env: only `CI=true`, `NODE_ENV=test`, `HOME=/home/sandbox`. Nothing from the worker's environment is passed.
- Limits: `Memory` 2 GiB, `NanoCpus` 2, `PidsLimit` 512, `Ulimits nofile`, wall-clock timeout 10 min install / 10 min test, then `kill` + `remove(force)`.
- Phases: (1) `install` via detected package manager with `--ignore-scripts` first; if tests need lifecycle scripts, a second attempt without the flag is allowed only when `allowLifecycleScripts` option is set by the user. (2) `test` with `--network none` (achieved by running two containers sharing the workspace volume rather than reconfiguring one).
- Output capture: exit code, stdout/stderr tails (64 KB each), duration, JUnit XML or JSON reporter output in `/out` if the runner supports it (the runner injects a reporter flag when it recognises vitest/jest).
- The **observed record** is written by worker code only, from these captured values.

Outcome classification (in `finalize`, deterministic):
- `improved`: baseline failed (or had failing tests) and patched run passes all, including the generated test.
- `unchanged`: both pass; generated test passes (fix is additive/safe but unproven).
- `regressed`: patched fails where baseline passed.
- `inconclusive`: baseline could not install/run, or timeouts.

## 9. GitHub integration design

**Decision: GitHub App with installation tokens; write operations via the Git Data API (blobs → tree → commit → ref) and Pulls API. No `git` binary.**
- *Why*: App installations give scoped, short-lived tokens per repository; Git Data API lets us build a commit from the patched tree we already have in memory.
- *Alternative A*: user OAuth tokens.
  - *Rejected for MVP*: needs a login flow and token storage; App installation is the standard for bots.
- *Alternative B*: personal access token in env.
  - *Accepted for local development only* (`GITHUB_TOKEN`), rejected for production because it grants the whole account.
- *Alternative C*: `git push` from a container.
  - *Rejected*: requires a credential inside a process that also touches repo content.
- *Tradeoff*: users must install the App on the target repo to get a PR; otherwise they download the patch.

Read path: unauthenticated for public repos (60 req/h — sufficient for ~4 API calls per run) with token when configured. Rate-limit headers are logged and `403/429` are `retryable`.

PR content: title from issue, body includes issue summary, patch rationale, **and** a link to the verification record with baseline vs patched exit codes and test counts. The body is generated by a template from observed data, not by the model.

## 10. Error-handling strategy

- All errors extend `RepoPilotError { code: ErrorCode; retryable: boolean; stage?: Stage; details?: unknown; userMessage: string }`.
- Error codes are a closed union in `packages/shared/errors.ts` (e.g. `INVALID_REPO_URL`, `REPO_NOT_FOUND`, `REPO_TOO_LARGE`, `UNSUPPORTED_ECOSYSTEM`, `AI_SCHEMA_INVALID`, `AI_REFUSED`, `AI_BUDGET_EXCEEDED`, `PATCH_INVALID`, `SANDBOX_UNAVAILABLE`, `SANDBOX_TIMEOUT`, `GITHUB_RATE_LIMITED`, `GITHUB_FORBIDDEN`, `INTERNAL`).
- Unknown errors are wrapped as `INTERNAL`, `retryable: false`, full stack logged, generic user message.
- Stage handlers never swallow errors; the worker's `failed` handler writes `runs.error_code/error_message`, an event, and marks status `failed` only after retries are exhausted.
- API maps `RepoPilotError` → HTTP status via a table; response body `{ error: { code, message, requestId } }`. Zod validation errors → `400 VALIDATION_ERROR` with issues array.
- Sandbox test failures are **not** errors. They are observed results with status `completed` and non-zero exit code.

## 11. Retry strategy

| Failure class | Example | Policy |
|---|---|---|
| Transient network / 5xx / 429 | GitHub, Anthropic, Docker daemon restart | BullMQ retry, exponential backoff 5 s → 20 s → 80 s, max 3 attempts |
| Model schema invalid | `parsed_output` null | 1 in-stage repair attempt with error feedback, then fail `AI_SCHEMA_INVALID` |
| Model refusal | `stop_reason = refusal` | No retry; fail `AI_REFUSED`; record category |
| Budget exceeded | token cap | No retry; fail `AI_BUDGET_EXCEEDED` |
| Deterministic validation failure | patch does not apply | No retry of the stage; the patch is `rejected`; pipeline continues with remaining patches |
| Sandbox timeout | test hangs | No retry; observed result `timed_out` |
| Sandbox infra | cannot create container | Up to 2 explicit re-enqueues, then `SANDBOX_UNAVAILABLE` |

Idempotency guarantees: stage handlers check for existing outputs first; DB writes use `ON CONFLICT (run_id, stage)`/unique keys; external side effects (PR creation) check for an existing PR row and existing branch before creating.

## 12. Observability strategy

- **Logs**: `pino` JSON to stdout; every log line carries `runId`, `stage`, `jobId`, `requestId`. `pino-http` for API access logs. Secrets are redacted via pino `redact` paths.
- **Run timeline**: `run_events` append-only table — the user-visible audit trail (`stage_started`, `stage_completed`, `ai_call`, `sandbox_started`, `sandbox_finished`, `error`). Also the primary debugging tool.
- **Metrics**: BullMQ queue depths/failed counts read from Redis; run durations per stage derived from `run_events`; exposed at `GET /metrics` (Prometheus text) in a later iteration. Day 1 exposes `/health` and `/ready` with dependency checks.
- **Model auditing**: `ai_calls` table (tokens, cache hits, latency, model, schema validity) enables cost dashboards and regression detection.
- **Tracing**: OpenTelemetry instrumentation is a Day 3+ item; correlation ids are in place now so traces can be attached later.

## 13. Testing strategy

| Layer | Tool | What | Runs where |
|---|---|---|---|
| Unit | Vitest | URL parsing, manifest builder, context ranking, diff parser/validator, test-output parser, Zod schemas, error mapping | every commit, no services |
| Contract | Vitest + fixtures | Recorded Anthropic responses (JSON fixtures) fed through schema parsing; ensures schema and prompt evolution stay compatible | every commit |
| Integration | Vitest + real PostgreSQL/Redis via compose | API → DB → queue → worker stage transitions; migrations | CI with services |
| Sandbox | Vitest + Docker | Fixture repos in `tests/fixtures/` run through the sandbox runner; asserts observed exit codes, limits, no network in test phase | CI runner with Docker |
| Evaluation | Custom harness (docs/EVALUATION.md) | Fix rate / precision on seeded-bug fixture repos with live model | nightly / manual |
| E2E | Playwright (later) | Submit URL in UI, see result | nightly |

Rule: nothing that requires the Anthropic API runs in the default `pnpm test`; live-model tests are gated behind `RUN_LIVE_AI=1`.

## 14. Security model (summary; full text in SECURITY.md)

Trust zones: **untrusted** = repository contents, model output, user-supplied URL; **semi-trusted** = GitHub API responses; **trusted** = our code, configuration.
Key controls: hardened extraction; no host execution; no secrets in sandbox; network off in test phase; patch denylist; schema validation; `source` column separation; API key auth; rate limiting per key; secrets only in worker env.

## 15. Deployment architecture

**Decision: single host, Docker Compose, five services (web, api, worker, postgres, redis) + a prebuilt sandbox image.**
- *Why*: matches the MVP's single-tenant scope; one command to run locally and in a small VM.
- *Alternative*: Kubernetes with a sandbox node pool.
  - *Rejected for MVP*: operational overhead; revisit when worker hosts need horizontal scaling or stronger tenancy isolation.
- *Tradeoff*: the worker container needs the host Docker socket (`/var/run/docker.sock`) to launch sandboxes — the "Docker-outside-of-Docker" pattern. This makes the worker root-equivalent on the host; it is the only service with the socket, and it never runs repository code itself. Production hardening path: dedicated worker VM, rootless Docker or a remote Docker/gVisor endpoint.

Environments:
- `dev`: `docker compose up postgres redis` + `pnpm dev` on the host for fast reload.
- `local-full`: `docker compose --profile full up` runs all services in containers.
- `prod` (single VM): same compose with `.env.production`, TLS at a reverse proxy, backups for PostgreSQL volume.

Configuration: all via environment variables, validated at startup with Zod (`packages/shared/env.ts`). A process refuses to start if a required variable is missing or malformed.

## 16. Day-1 implementation boundary

Implemented on Day 1: workspace scaffolding, env validation, DB client + SQL
migrations + schema, Redis/BullMQ connection, `pipeline` queue, worker with a
stage registry (stages return `NOT_IMPLEMENTED` so the plumbing can be proven
end-to-end), Express API with `/health`, `/ready`, `POST/GET /api/v1/runs`,
`GET /api/v1/runs/:id/events`, Next.js page that creates and polls a run,
Docker Compose for postgres/redis/api/worker/web, unit + integration tests.

Not implemented on Day 1 (by design): tarball ingestion, manifest, context
selection, model calls, patch validation, sandbox runner, PR creation. Each has
its module location and interface reserved (see `packages/*/src/index.ts`).
