# RepoPilot — Database Design

PostgreSQL 16. Schema managed by plain SQL migration files in `packages/shared/migrations/` applied by a small runner (`pnpm db:migrate`). PostgreSQL is the **source of truth**; Redis holds only queue state and short-lived caches.

## Decision: `pg` + hand-written SQL migrations, no ORM (MVP)
- *Why*: eight tables with simple access patterns; SQL migrations are transparent, reviewable and never surprise us with generated DDL. Row shapes are validated with the same Zod schemas used by the API, so type safety is preserved at the boundary.
- *Alternative A*: Prisma. *Rejected*: generated client + query engine binary, heavier cold start in the worker, schema DSL diverges from SQL when we need `CHECK` constraints and partial indexes.
- *Alternative B*: Drizzle. *Closest contender*; deferred. If query volume/complexity grows, Drizzle can be introduced on top of the same tables without a migration rewrite.
- *Tradeoff*: hand-written mapping code for each table; mitigated by keeping repositories thin (`packages/shared/src/db/repos/*.ts`).

## Decision: UUID v7 primary keys, generated in the application
- *Why*: time-ordered (index-friendly), globally unique across api/worker, usable in URLs before the row exists.
- *Alternative*: `bigserial`. *Rejected*: leaks counts, requires round-trip to know the id.

## Decision: `source` column + `CHECK` constraints to separate inference from observation
- *Why*: the rule "AI must never fabricate verification results" must be enforced by the schema, not by convention. `verification_runs.source` is constrained to `'observed'`; `issues/patches/generated_tests.source` is constrained to `'ai_inference'`. There is no table where both can be mixed.
- *Alternative*: one `artifacts` table with a `kind` column. *Rejected*: invites accidental cross-writes and weakens constraints.

## Entity relationship

```
runs 1──1 repository_snapshots
runs 1──* run_events
runs 1──1 context_bundles
runs 1──* ai_calls
runs 1──* issues 1──0..1 patches 1──0..1 generated_tests
runs 1──* verification_runs  (patch_id NULL for baseline)
runs 1──* pull_requests (patch_id)
```

## Tables

### `runs`
| column | type | notes |
|---|---|---|
| id | uuid PK | v7 |
| repo_url | text NOT NULL | normalised |
| owner | text NOT NULL | |
| repo | text NOT NULL | |
| ref | text | requested ref, null = default branch |
| commit_sha | char(40) | resolved during ingest |
| status | text NOT NULL | `queued|running|completed|failed|cancelling|cancelled` (CHECK) |
| stage | text NOT NULL | current/last stage (CHECK against stage list) |
| options | jsonb NOT NULL DEFAULT '{}' | validated `RunOptions` |
| error_code | text | `ErrorCode` |
| error_message | text | sanitised |
| created_at / updated_at | timestamptz NOT NULL | |
| started_at / finished_at | timestamptz | |

Indexes: `(status, created_at desc)`, `(created_at desc)`.

### `run_events` (append-only)
| column | type |
|---|---|
| id | bigserial PK |
| run_id | uuid FK → runs ON DELETE CASCADE |
| stage | text |
| level | text CHECK `debug|info|warn|error` |
| type | text (e.g. `stage_started`, `stage_completed`, `ai_call`, `sandbox_finished`, `error`) |
| message | text NOT NULL |
| data | jsonb NOT NULL DEFAULT '{}' |
| created_at | timestamptz NOT NULL DEFAULT now() |

Index: `(run_id, id)`.

### `repository_snapshots`
| column | type |
|---|---|
| id | uuid PK |
| run_id | uuid UNIQUE FK |
| commit_sha | char(40) NOT NULL |
| default_branch | text |
| file_count | int NOT NULL |
| total_bytes | bigint NOT NULL |
| ecosystem | jsonb | package manager, test runner, scripts |
| manifest | jsonb | file list (can be large; fetched only on demand) |
| workspace_path | text | host path on worker; null after cleanup |
| created_at | timestamptz |

### `context_bundles`
| column | type |
|---|---|
| id | uuid PK |
| run_id | uuid UNIQUE FK |
| files | jsonb NOT NULL | `[ { path, ranges?, score, reasons[] } ]` |
| token_count | int | measured or estimated |
| token_count_method | text CHECK `measured|estimated` |
| created_at | timestamptz |

### `ai_calls`
| column | type |
|---|---|
| id | uuid PK |
| run_id | uuid FK |
| stage | text NOT NULL |
| model | text NOT NULL |
| purpose | text NOT NULL (`analyze|generate_patches|generate_tests|repair`) |
| input_tokens / output_tokens / cache_read_tokens / cache_write_tokens | int |
| latency_ms | int |
| stop_reason | text |
| schema_valid | boolean NOT NULL |
| error_code | text |
| created_at | timestamptz |

Index: `(run_id)`, `(created_at)` for cost reports.

### `issues`
| column | type |
|---|---|
| id | uuid PK |
| run_id | uuid FK |
| source | text NOT NULL CHECK (`source = 'ai_inference'`) |
| ordinal | int NOT NULL | order returned by model; UNIQUE `(run_id, ordinal)` |
| severity | text CHECK `low|medium|high|critical` |
| category | text CHECK `bug|security|reliability|type_safety|other` |
| confidence | numeric(3,2) CHECK 0–1 |
| title | text NOT NULL |
| explanation | text NOT NULL |
| file_path | text NOT NULL |
| line_start / line_end | int |
| evidence | text |
| created_at | timestamptz |

### `patches`
| column | type |
|---|---|
| id | uuid PK |
| run_id | uuid FK |
| issue_id | uuid UNIQUE FK → issues |
| source | text CHECK (`'ai_inference'`) |
| status | text CHECK `proposed|validated|rejected` |
| rationale | text |
| diff | text NOT NULL |
| files_touched | text[] NOT NULL |
| validation | jsonb | `{ ok, checks: [{name, ok, detail}] }` |
| outcome | text CHECK `improved|unchanged|regressed|inconclusive` NULL | set only by `finalize` from `verification_runs` |
| created_at | timestamptz |

### `generated_tests`
| column | type |
|---|---|
| id | uuid PK |
| run_id | uuid FK |
| patch_id | uuid UNIQUE FK → patches |
| source | text CHECK (`'ai_inference'`) |
| path | text NOT NULL |
| framework | text |
| content | text NOT NULL |
| status | text CHECK `proposed|validated|rejected` |
| created_at | timestamptz |

### `verification_runs`
| column | type |
|---|---|
| id | uuid PK |
| run_id | uuid FK |
| patch_id | uuid FK → patches NULL | NULL ⇒ baseline |
| kind | text CHECK `baseline|patched` |
| source | text NOT NULL CHECK (`source = 'observed'`) |
| status | text CHECK `running|completed|timed_out|infra_error|cancelled` |
| image_digest | text |
| command | text |
| install_exit_code / test_exit_code | int |
| install_duration_ms / test_duration_ms | int |
| stdout_tail / stderr_tail | text | ≤ 64 KB each |
| test_summary | jsonb | `{ total, passed, failed, skipped, parser }` |
| started_at / finished_at | timestamptz |

Constraints: UNIQUE `(run_id, kind, patch_id)`; CHECK `(kind = 'baseline') = (patch_id IS NULL)`.

### `pull_requests`
| column | type |
|---|---|
| id | uuid PK |
| run_id | uuid FK |
| patch_id | uuid UNIQUE FK |
| status | text CHECK `creating|open|failed|closed|merged` |
| number | int |
| url | text |
| head_branch | text |
| error_code | text |
| created_at / updated_at | timestamptz |

### `schema_migrations`
`version text PK, applied_at timestamptz`. Written by the migration runner.

## Retention
- `run_events`, `ai_calls`: keep 90 days (cron later).
- `repository_snapshots.manifest`: nulled after 30 days; commit SHA retained.
- `verification_runs.stdout_tail/stderr_tail`: capped at write time.

## Day-1 status
Migration `0001_init.sql` creates all tables above with constraints and indexes. Only `runs` and `run_events` are written by Day-1 code; the others are created now so the constraints (especially the `source` CHECKs) exist before any stage code is written.
