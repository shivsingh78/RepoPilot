-- RepoPilot initial schema. See docs/DATABASE.md.
-- Provenance rule: verification_runs.source is constrained to 'observed';
-- issues/patches/generated_tests.source is constrained to 'ai_inference'.

CREATE TABLE IF NOT EXISTS runs (
  id            uuid PRIMARY KEY,
  repo_url      text NOT NULL,
  owner         text NOT NULL,
  repo          text NOT NULL,
  ref           text,
  commit_sha    char(40),
  status        text NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelling','cancelled')),
  stage         text NOT NULL CHECK (stage IN ('ingest','manifest','select_context','analyze','generate_patches','validate_patches','generate_tests','verify_baseline','verify_patches','finalize')),
  options       jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code    text,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS runs_status_created_idx ON runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_created_idx ON runs (created_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  id         bigserial PRIMARY KEY,
  run_id     uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  stage      text,
  level      text NOT NULL CHECK (level IN ('debug','info','warn','error')),
  type       text NOT NULL,
  message    text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_events_run_idx ON run_events (run_id, id);

CREATE TABLE IF NOT EXISTS repository_snapshots (
  id             uuid PRIMARY KEY,
  run_id         uuid NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  commit_sha     char(40) NOT NULL,
  default_branch text,
  file_count     integer NOT NULL,
  total_bytes    bigint NOT NULL,
  ecosystem      jsonb,
  manifest       jsonb,
  workspace_path text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS context_bundles (
  id                 uuid PRIMARY KEY,
  run_id             uuid NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  files              jsonb NOT NULL,
  token_count        integer,
  token_count_method text CHECK (token_count_method IN ('measured','estimated')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_calls (
  id                 uuid PRIMARY KEY,
  run_id             uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  stage              text NOT NULL,
  model              text NOT NULL,
  purpose            text NOT NULL,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,
  latency_ms         integer,
  stop_reason        text,
  schema_valid       boolean NOT NULL,
  error_code         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_calls_run_idx ON ai_calls (run_id);
CREATE INDEX IF NOT EXISTS ai_calls_created_idx ON ai_calls (created_at);

CREATE TABLE IF NOT EXISTS issues (
  id          uuid PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source = 'ai_inference'),
  ordinal     integer NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  category    text NOT NULL CHECK (category IN ('bug','security','reliability','type_safety','other')),
  confidence  numeric(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  title       text NOT NULL,
  explanation text NOT NULL,
  file_path   text NOT NULL,
  line_start  integer,
  line_end    integer,
  evidence    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS patches (
  id            uuid PRIMARY KEY,
  run_id        uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  issue_id      uuid NOT NULL UNIQUE REFERENCES issues(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source = 'ai_inference'),
  status        text NOT NULL CHECK (status IN ('proposed','validated','rejected')),
  rationale     text,
  diff          text NOT NULL,
  files_touched text[] NOT NULL DEFAULT '{}',
  validation    jsonb,
  outcome       text CHECK (outcome IN ('improved','unchanged','regressed','inconclusive')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generated_tests (
  id         uuid PRIMARY KEY,
  run_id     uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  patch_id   uuid NOT NULL UNIQUE REFERENCES patches(id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source = 'ai_inference'),
  path       text NOT NULL,
  framework  text,
  content    text NOT NULL,
  status     text NOT NULL CHECK (status IN ('proposed','validated','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_runs (
  id                  uuid PRIMARY KEY,
  run_id              uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  patch_id            uuid REFERENCES patches(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('baseline','patched')),
  source              text NOT NULL CHECK (source = 'observed'),
  status              text NOT NULL CHECK (status IN ('running','completed','timed_out','infra_error','cancelled')),
  image_digest        text,
  command             text,
  install_exit_code   integer,
  test_exit_code      integer,
  install_duration_ms integer,
  test_duration_ms    integer,
  stdout_tail         text,
  stderr_tail         text,
  test_summary        jsonb,
  started_at          timestamptz,
  finished_at         timestamptz,
  CONSTRAINT verification_kind_patch CHECK ((kind = 'baseline') = (patch_id IS NULL)),
  UNIQUE NULLS NOT DISTINCT (run_id, kind, patch_id)
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id          uuid PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  patch_id    uuid NOT NULL UNIQUE REFERENCES patches(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('creating','open','failed','closed','merged')),
  number      integer,
  url         text,
  head_branch text,
  error_code  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
