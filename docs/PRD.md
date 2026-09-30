# RepoPilot — Product Requirements Document

Status: Draft v0.1 (Day 1)
Owner: Engineering
Last updated: 2026-09-30

## 1. Problem

Engineers inherit or evaluate repositories they do not fully understand. Finding
real defects, proposing a fix, and proving the fix works takes hours of manual
work: cloning, reading, guessing at the test setup, running things locally.

RepoPilot takes a GitHub URL and produces a **verified** result: a list of
issues, a candidate patch per issue, generated tests, and a runtime record that
shows what actually happened when the patched repository was executed in an
isolated sandbox. Optionally it opens a pull request.

The word *verified* is the product. Many tools can ask a model "what is wrong
with this code". RepoPilot's differentiator is that every claim of "fixed" is
backed by an observed sandbox run, and the UI never blurs the line between what
the model believes and what the sandbox observed.

## 2. Users

| Persona | Job to be done | Success looks like |
|---|---|---|
| Maintainer of a small/medium open-source JS/TS project | Triage latent bugs, get a reviewable PR | A PR with a green test run they can merge after a 5‑minute review |
| Engineer evaluating an unfamiliar repo | Understand risk quickly | A ranked issue list with evidence and confidence, in minutes |
| Platform/DevEx team (later) | Run RepoPilot on internal repos on a schedule | Self-hostable, auditable, secrets never leak to repo code |

## 3. Core workflow

```
GitHub URL
  → repository ingestion        (download snapshot, enforce limits)
  → repository manifest         (file tree, languages, ecosystem, scripts)
  → relevant-context selection  (deterministic ranking within a token budget)
  → AI analysis                 (schema-validated issues; labelled AI inference)
  → issues                      (persisted, ranked)
  → patch generation            (schema-validated unified diffs)
  → patch validation            (deterministic checks, no execution)
  → test generation             (schema-validated test files)
  → Docker verification         (baseline run + patched run, observed results)
  → final result                (issues + patches + observed evidence)
  → optional GitHub PR
```

## 4. MVP scope (what ships first)

**Repository support**
- Public GitHub repositories, or private ones the GitHub App is installed on.
- Node.js / TypeScript projects using npm, pnpm, or yarn, with a `test` script.
- Size limits: ≤ 5,000 files, ≤ 100 MB extracted, ≤ 2 MB per file for analysis.

**Analysis**
- Up to 10 issues per run, categories: bug, security, reliability, type‑safety.
- Every issue carries: file, line range, severity, confidence, evidence snippet.

**Repair**
- One patch per issue, unified diff, must apply cleanly to the snapshot.
- Patches may touch source and test files only; workflow/CI/config denylist.
- One generated test file per patch, placed alongside existing tests.

**Verification**
- Baseline run (unpatched) and patched run of the repository's test command in
  a Docker sandbox with CPU/memory/time limits and no secrets.
- Result classification per patch: `improved`, `unchanged`, `regressed`,
  `inconclusive` (e.g. baseline could not run).

**Delivery**
- Web UI: submit URL, watch stage progress, browse issues/patches/evidence.
- REST API with the same capabilities.
- Optional PR: branch + commit + PR created through the GitHub API, PR body
  links to the observed verification record.

**Operations**
- Single `docker compose up` for local/dev and single-host deployment.
- Health/readiness endpoints, structured logs, per-run event timeline.

## 5. Explicit non-goals (MVP)

- Languages other than JS/TS (Python, Go, Java, Rust) — later, the manifest and
  sandbox are designed to be extensible but only one ecosystem ships.
- Monorepo-wide multi-package analysis; MVP analyses the root package only.
- Embedding/vector search over code. Context selection is heuristic.
- Multi-tenant SaaS with billing, orgs, RBAC. MVP is single-tenant with a
  shared API key.
- Real-time collaborative review, inline comments, chat with the repo.
- Auto-merge. RepoPilot never merges; a human does.
- Running arbitrary user-provided commands in the sandbox.
- Kubernetes, service mesh, multi-region. Single host + compose.
- Fine-tuned or self-hosted models. Anthropic API only.
- Automatic re-runs on push (webhooks). Runs are user-initiated.

## 6. Functional requirements

| ID | Requirement |
|---|---|
| F1 | Accept a GitHub URL (`https://github.com/{owner}/{repo}`, optional `/tree/{ref}`), validate and normalise it. |
| F2 | Create a **run** and return its id within 200 ms; all work is asynchronous. |
| F3 | Expose run status, current stage, and an ordered event timeline. |
| F4 | Persist a repository snapshot manifest with commit SHA so results are reproducible. |
| F5 | Persist issues, patches, generated tests, verification runs and PRs as separate records linked to the run. |
| F6 | Every AI-produced record is tagged `source = 'ai_inference'`. Every sandbox record is tagged `source = 'observed'`. The API never returns a verification status that did not come from a sandbox run. |
| F7 | A patch is never executed unless it passed deterministic validation. |
| F8 | Users can cancel a run; in-flight sandbox containers are killed. |
| F9 | Users can request a PR only for patches whose verification is `improved` or `unchanged` with all tests passing. |
| F10 | Results are downloadable as JSON and as `.patch` files. |

## 7. Non-functional requirements

| Area | Target |
|---|---|
| Latency | Run creation < 200 ms p95. End-to-end run for a 500‑file repo < 10 min p50. |
| Throughput | 5 concurrent runs per worker host (bounded by sandbox CPU/memory). |
| Isolation | Repository code executes only inside a container with no network (test phase), no secrets, non-root, capped resources. |
| Reliability | Any stage can be retried without duplicating side effects (idempotent by `run_id + stage`). |
| Auditability | Every model call is recorded (model, tokens, latency, schema validity). |
| Cost | Hard cap on model tokens per run (configurable, default 600k input / 60k output). |
| Portability | Runs on a Linux host with Docker; no cloud-specific services required. |

## 8. Success metrics (see docs/EVALUATION.md)

- **Verified fix rate**: patches whose patched sandbox run improves on baseline / patches proposed.
- **Patch validity rate**: patches that pass deterministic validation / patches generated.
- **Precision of issues**: issues judged real by a human panel / issues reported.
- **Inconclusive rate**: runs where baseline could not execute. Target < 20% on the benchmark set.
- **Cost per run** and **time per run**.

## 9. Key product decisions

### 9.1 Verification is mandatory, not optional
- **Why**: without observed runtime evidence the output is indistinguishable from a chat transcript; trust is the product.
- **Alternative**: ship analysis-only first and add verification later.
- **Rejected because**: it would shape the data model and UI around unverified claims, which is exactly what we must avoid.
- **Tradeoff**: slower runs, Docker becomes a hard dependency, some repos are `inconclusive`.

### 9.2 JS/TS only in MVP
- **Why**: one ecosystem lets us make the sandbox image, install step and test-output parsing reliable.
- **Alternative**: language-agnostic "run whatever `make test` does".
- **Rejected because**: unbounded install/test behaviour makes verification results noisy and the sandbox harder to constrain.
- **Tradeoff**: smaller addressable set of repositories at launch.

### 9.3 Snapshot-based, user-initiated runs
- **Why**: a pinned commit SHA makes results reproducible and PRs coherent.
- **Alternative**: webhook-driven continuous analysis.
- **Rejected because**: adds GitHub App event handling, deduplication and quota concerns before the core loop is proven.
- **Tradeoff**: results can go stale if the repo moves.

## 10. Open questions

- Should PR creation use a fork when the App is not installed on the target? (Deferred; MVP requires installation.)
- How much of the generated test should be trusted as a regression guard vs. a smoke check? Tracked in EVALUATION.md.
