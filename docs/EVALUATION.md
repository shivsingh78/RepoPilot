# RepoPilot — Evaluation Strategy

The product claim is "verified fixes". Evaluation therefore measures two separate things and never conflates them:

1. **Inference quality** — did the model find real issues and propose good patches?
2. **Observed outcomes** — what actually happened when the patched code ran?

## 1. Benchmark set

`tests/fixtures/repos/` contains small, licence-clean Node/TS repositories with **seeded, documented defects**. Each fixture has:
- `README.fixture.md`: the seeded defects (file, line, category) and the expected passing test command.
- A pristine test suite that passes before seeding and fails (or under-specifies) after.
- `expected.json`: ground truth used by the harness.

Initial set (Day 2+): 8–12 fixtures covering off-by-one, null handling, async race, wrong error propagation, unsafe `eval`/regex, type-narrowing bug, dependency misuse. Plus 3 "clean" repos with no seeded defects to measure false positives.

Live public repositories are used for qualitative review only, not for the scored benchmark (non-reproducible).

## 2. Metrics

| Metric | Definition | Source |
|---|---|---|
| Issue precision | reported issues matching a seeded defect (same file, overlapping lines, same category) / reported | inference vs ground truth |
| Issue recall | seeded defects matched / seeded | inference vs ground truth |
| False-positive rate on clean repos | issues reported on clean fixtures / fixtures | inference |
| Patch validity rate | patches `validated` / patches `proposed` | deterministic |
| **Verified fix rate** | patches with `outcome = improved` / patches `validated` | **observed** |
| Regression rate | `outcome = regressed` / `validated` | observed |
| Inconclusive rate | runs where baseline was `infra_error` or `timed_out` / runs | observed |
| Generated-test usefulness | generated test fails on baseline and passes on patched / generated tests | observed |
| Cost per run | sum of `ai_calls` token cost | measured |
| Time per run / per stage | from `run_events` | measured |
| Schema-invalid rate | `ai_calls.schema_valid = false` / calls | measured |

Headline numbers are **verified fix rate** and **issue precision**. Neither can be improved by the model asserting success, because both depend on deterministic matching or on sandbox observation.

## 3. Harness

`pnpm eval` (Day 2+), in `tests/eval/`:
1. For each fixture: create a local snapshot (bypassing GitHub download via a `file://` ingestion adapter used only in tests).
2. Run the full pipeline against the live model (`RUN_LIVE_AI=1`) with a fixed `model`, `effort`, prompt version and seed-independent settings.
3. Collect DB rows; compute metrics; write `eval-results/<timestamp>.json` and a markdown summary.
4. Compare with the previous baseline file; fail CI (nightly) if verified fix rate drops > 10 points or regression rate rises > 5 points.

Prompt and schema versions are recorded on every `ai_calls` row (`prompt_version` added Day 2) so results can be attributed.

## 4. Human review protocol
Weekly, sample 20 issues from real runs. Two reviewers label each as `real | plausible | false`. Track inter-rater agreement. Feed disagreements into fixture creation.

## 5. Guardrail evaluations (must always pass)
- No `verification_runs` row exists with `source != 'observed'` (query in CI).
- No patch reaches `verify_patches` with `status != validated`.
- Sandbox network test: a fixture whose test suite attempts an outbound HTTP call must record a failure in the test phase.
- Secret canary: a fixture whose test prints `process.env` must show none of the worker's secret names in `stdout_tail`.

## 6. Reporting
The web UI shows, per patch: the inference (issue, rationale, diff) with an "AI inference" badge, and the observation (baseline vs patched exit codes, test counts, duration) with an "Observed in sandbox" badge. The eval report uses the same split so internal metrics and user-facing claims line up.
