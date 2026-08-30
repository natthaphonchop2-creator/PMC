# Task 6 Report — Privacy-safe timings and performance evidence harness

## Status

Implemented locally on base `40daf74`. This task adds passive telemetry plus offline-safe measurement/evaluation tooling only. It did not deploy, launch a browser, run a live synthetic Booking, upload evidence, call GCS/Drive/Apps Script/Sheets/LINE/Calendar/JERA/Cloud Tasks, expand the async owner allowlist, or change a Booking route result or durability boundary.

## Privacy-safe telemetry

- Added strict prepare/confirm phase telemetry with exact event, route, action, status, state, file-count, attempt, and elapsed-time allowlists.
- Server phases cover LINE verification, active-staff snapshot, owned-draft read, config snapshot, multipart parse, persistence, task enqueue, state ingress, authoritative recovery reread, and total request time.
- The runtime writer is non-blocking: validation/writer/timing-source failure cannot alter a Booking response.
- Existing async lifecycle telemetry now emits aggregate-only route/action/status/state/attempt/fileCount/elapsedMs. Request IDs, draft IDs, Case IDs, safe error codes, URLs, filenames, byte counts, and business/customer values were removed from emitted events under the approved privacy contract.
- Internal idempotency/deduplication logic still uses exact request/draft/task bindings, but those identities are not emitted. Operational diagnostics retain safe phase, state, status, attempt, file count, and duration.
- Browser API callbacks measure prepare/confirm request duration. Wizard callbacks measure successful click-to-preview and click-to-Home duration. Their exact schema permits only action/status/elapsedMs, rejects DOM text/attributes/input values/IDs/URLs/file metadata/nested data, and cannot alter the user flow when a callback throws.

## Offline performance harness

- Added an exact aggregate schema containing only revision label, UTC/Bangkok timestamps, fixture label, safe route/status, count, p50/p95/max, and aggregate gate counts.
- `--help` and `--evaluate <aggregate.json>` are offline; they do not import a live runner, browser, or network client.
- The runner design executes one discarded warm-up plus 30 retained attempts for async prepare, sync prepare, legacy sync prepare, and async confirm, followed by seven bounded fixtures and five concurrent clients.
- Exact fixture specifications cover 2×500 KB, 5×2 MB, 20 files totaling 25 MB, 26,000,001-byte chunk overflow, invalid MIME, partial failure after two persisted files, and response-loss idempotent recovery.
- The evaluator fails closed on malformed/extra/private fields and implements the exact failure enum:
  - `INSUFFICIENT_SUCCESS_RUNS`
  - `ASYNC_PREPARE_P95`
  - `SYNC_PREPARE_MEDIAN_REDUCTION`
  - `ASYNC_CONFIRM_P95`
  - `UNAVAILABLE_ROUTE_PROBE`
  - `MAX_FIXTURE_FAILURE`
  - `CONCURRENCY_DUPLICATE`
- Owner-gated live mode requires `--live`, the literal `--owner-approved` flag, `PMC_BOOKING_PERFORMANCE_OWNER_GATE=APPROVED`, a reviewed revision label, a separately reviewed runner module, and a new aggregate output path. No default or help/evaluate path can enter live mode.

## INP and Long Animation Frame harness

- Applied the mandatory modern-web guidance for INP/Event Timing and Long Animation Frames before client instrumentation.
- The owner-gated harness observes controlled `preview` and `confirm` interactions only. It aggregates input delay, processing, presentation, INP, longest-frame, and longest-script durations without retaining targets, DOM content, source URLs, screenshots, or raw samples.
- Long Animation Frames are optional and degrade to zero duration when unsupported; no polyfill or speculative runtime dependency was added.
- `routeSplittingGate=REQUIRED` is recorded only when p95 INP exceeds 200 ms or a measured script task exceeds 50 ms. This task does not perform lazy-loading or route-splitting changes.
- `--help` does not import Playwright or open a browser. Live/browser mode was not invoked.

## TDD evidence

RED was observed before implementation:

- The new performance suite failed at import because `bookingPerformanceTelemetry.ts` and both measurement scripts did not exist.
- The revised async telemetry test rejected the new identifier-free aggregate schema under the old ID-required contract.

GREEN evidence:

- Complete performance-plan selection: **9 files, 259 tests passed**.
- Apps Script Booking suite: **49 files, 693 tests passed**.
- `npm run booking:typecheck`: passed.
- Full repository suite with bounded four-worker scheduling: **187 files, 2,633 tests passed**.
- The default maximally parallel full run reached only the unrelated OCR job's fixed 20-second nested-build timeout; that OCR test passed **2/2** in isolation, and the complete four-worker run passed.
- Full `npm run build`: passed. The existing main-client large-chunk advisory remains unchanged.
- Full `npm run lint`: zero errors and one pre-existing generated `dist-server/server/pmc-mini-app/taskQueue.js` unused-disable warning.
- Touched-path ESLint: passed with zero findings.
- Both measurement scripts passed `node --check`.
- Booking harness `--help`: exit 0 without live import.
- Passing aggregate fixture: exit 0 with no failures.
- Failing aggregate fixture: exit 1 with all seven exact safe failure labels.
- INP harness `--help`: exit 0 without browser/runner import.
- `git diff --check`: passed.

## Runbook and stop point

The async Booking runbook now documents the identifier-free telemetry contract, aggregate-only log queries, offline commands, exact thresholds/fixtures, INP follow-up gate, and the separate owner approval required before live measurement. This task stops before canary, real owner timing, worker evidence optimization, traffic, deployment, or all-staff async expansion.
