# Testing and verification boundaries

Use Node 22.12+ and Python 3.12+; Docker/cluster tests require their actual runtimes. `docs/PROGRESS.md` records executed results rather than predictions.

```powershell
npm.cmd ci
npm.cmd run db:generate
npm.cmd test
npm.cmd run validate:openapi
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r worker/requirements.txt
.\.venv\Scripts\python.exe -m pytest tests/test_processing.py -q
npm.cmd run build
npm.cmd run verify:infra
```

Vitest/Supertest tests exercise actual Express middleware, Zod validation, Sharp signature decoding, accepted asynchronous job contracts, private download gating, upload compensation and safe errors. PostgreSQL, Redis and S3 are mocked in these boundary tests; external integration is separately verified by live E2E. Outbox tests verify deterministic generation IDs and publishing recovery without republishing an existing active delivery. Pytest uses actual Pillow encoders and decoders, checks dimensions/pixels/transparency, and rejects bad settings/corrupt/bomb/animated inputs. No fake success logs are used.

`verify:infra` parses Compose, Kubernetes and monitoring YAML/JSON, checks required services, deployment probes/resources and matching KEDA queue names. It is static validation and cannot replace `docker compose config`, `kubectl apply --dry-run=server`, image builds, or real cluster execution.

## OpenAPI contract validation

```powershell
# No running services required for the source contract:
npm.cmd run validate:openapi
# Also validate the document actually served by the running API or gateway:
npm.cmd run validate:openapi -- http://localhost:3000/api/v1/openapi.json
npm.cmd run validate:openapi -- http://localhost:8080/api/v1/openapi.json
```

The pinned `@apidevtools/swagger-parser` validates OpenAPI 3.0 schema structure and resolves all internal references. External reference loading is disabled. Served/saved documents are also compared with the source contract so stale deployments fail verification. Parser regression tests reject the earlier malformed components nesting and unresolved schema references. This validates the API document; live browser and smoke tests separately verify runtime processing behavior.

## Browser tests

```powershell
npm.cmd run test:browser:install
npm.cmd run test:e2e
```

Without `BASE_URL`, Playwright starts Vite at http://localhost:5173. The two UI tests explicitly return unavailable API responses, then verify honest empty/error states, saved preferences, architecture selection, responsive layout and mobile navigation. They verify real React behavior, without claiming that mocked metrics represent a live service.

To test the full system:

```powershell
docker compose --profile monitoring up --build -d
$env:BASE_URL='http://localhost:8080'
$env:LIVE_E2E='1'
npm.cmd run test:e2e
```

The suite has seven cases: two explicitly offline UI cases and five gated real-service cases. Live coverage includes resize/WebP processing, JPEG/WebP batch conversion into rotated grayscale PNG thumbnails, all six pages at desktop and mobile widths, history filtering/sorting/details, monitoring health, architecture interaction, persisted preferences/theme, and a complete mobile JPEG workflow including actual download bytes. Live cases are skipped unless `LIVE_E2E=1`; skipped integration tests are not passing integration tests.

After deploying the local kind stack and its monitoring overlay, Windows users can run `powershell -ExecutionPolicy Bypass -File scripts/test-kubernetes.ps1`. It temporarily stops Compose, starts hidden Kubernetes port-forwards, runs the full browser suite and authenticated Grafana provisioning checks, then restores Compose in a `finally` block. It uses the workspace-local `.local/kubeconfig` and existing cluster resources; it does not create or delete a cluster.

## Screenshots

Capture actual running UI rather than synthetic results:

```sh
npx playwright screenshot --device="Desktop Chrome" --wait-for-timeout=3000 http://localhost:8080 docs/dashboard.png
npx playwright screenshot --device="iPhone 13" --browser=chromium --wait-for-timeout=3000 http://localhost:8080/process docs/process-mobile.png
```

Take a completed-job screenshot after running a real sample. Label offline/error-state screenshots explicitly. Browser failure screenshots go under ignored `test-results/`. Use representative real outputs without private user images.

## Load and resilience checks

With the real local stack running, additional automated integration checks are available:

```powershell
$env:SMOKE_FAILURES='1'
npm.cmd run test:smoke
# Intentional faults in this project's Compose services, with restoration in finally blocks:
$env:CRASH_WORKER='1'
node scripts/resilience.mjs
```

The smoke check processes actual PNG/JPEG/WebP fixtures, verifies an unsigned original returns 403, validates output bytes/dimensions, checks signed downloads/SSE/metrics, and optionally corrupts then restores its own generated fixture to verify permanent failure and manual retry. Reports are written to ignored `.local/smoke-report.json`.

The resilience check stops Redis, accepts a job in PostgreSQL while the queue is offline, restores Redis and checks completion. Optional `CRASH_WORKER=1` kills the demo processing worker during a large transformation, restarts it, and asserts that BullMQ redelivers and completes the job. This can take two to three minutes because the reservation must expire. It writes `.local/resilience-report.json`. These scripts require real services and are not claimed passed until recorded in PROGRESS.md.

```powershell
.\.venv\Scripts\python.exe scripts/fixtures.py
$env:JOBS='30'
npm.cmd run load
```

This submits real jobs using one generated PNG upload, polls aggregate terminal outcomes every 15s for at most five minutes, and exits nonzero for processing failures/timeouts. Counts are actual responses. The load script supports 1–200 jobs to avoid unbounded local workload. It reads paginated history in batches of 100 and matches its submitted UUIDs, keeping polling within the API rate limit rather than issuing one request per job on every interval.

Compose scaling: `docker compose up -d --scale worker=3`. Kubernetes scaling: use docs/KUBERNETES.md's KEDA path and observe `LLEN`, pods and HPA. Compare completion throughput and successful-attempt durations, keeping original size/settings identical. Deliberate recovery experiments: stop workers before submission to demonstrate queued state; restart; transiently stop/restart MinIO during processing to observe retry; terminate a worker during processing to exercise BullMQ stalled recovery. These affect running demo services and should be performed intentionally in an isolated environment.

Corrupt inputs should produce HTTP 400 if rejected during upload, or a permanent failed processing record if corruption is found at full Pillow decode. Failed retries need an actual failed job; do not manufacture a successful recovery screenshot. Upload a fresh image if lifecycle expiration removed its source.
