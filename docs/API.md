# API contracts

Base: `/api/v1`. JSON except multipart upload, SSE and Prometheus. Interactive schemas: `/api/v1/docs`; machine contract: `/api/v1/openapi.json`. This local application has one shared workspace, no tenant authentication; keep it on loopback until adding identity/authorization.

Validate the source contract with `npm run validate:openapi`, or validate a deployed copy and source parity with `npm run validate:openapi -- http://localhost:3000/api/v1/openapi.json`. The parser checks OpenAPI 3.0 schema structure and internal references. Queued jobs explicitly allow null output metadata, and expired downloads document HTTP 410.

| Method / endpoint | Success | Contract |
| --- | --- | --- |
| POST `/images/upload` | 201 | Multipart `images` repeated 1–8 times; `{uploads:[...]}` |
| POST `/jobs` | 202 | `{uploadIds:[UUID],transformations:{...}}`; `{jobs:[Job]}` |
| GET `/jobs` | 200 | `page=1&limit=15&status=queued&search=filename&sort=newest`; `{jobs,total,page,pages}` |
| GET `/jobs/:id` | 200 | Job, upload metadata, requested settings, audit, original/result preview URLs |
| GET `/jobs/:id/events` | 200 | SSE `event: job`, JSON snapshot every 2 seconds; closes at terminal state or 120s |
| GET `/jobs/:id/download` | 200 | Completed only: `{url,expiresIn:300}` |
| POST `/jobs/:id/retry` | 202 | Failed only; atomic generation increment; new queued Job |
| POST `/jobs/:id/cancel` | 409 | Safely unsupported, with explicit explanation |
| GET `/dashboard/stats` | 200 | DB totals/status counts, average duration, real queue counts, connected consumers, seven-day activity, limits |
| GET `/health/live` | 200 | API process liveness, independent of dependencies |
| GET `/health/ready` | 200/503 | `{services:{database:up/down,redis:up/down,storage:up/down}}` |
| GET `/metrics` | 200 | Prometheus text exposition |
| GET `/docs` | 200 | Swagger UI |

### Upload and create

```json
{"uploadIds":["6d8da9be-426f-45d9-8499-dad6ed71b558"],"transformations":{"width":800,"height":600,"preserveAspect":true,"format":"webp","quality":82,"rotate":90,"grayscale":false,"thumbnail":false,"watermark":"CloudFrame"}}
```

Width/height optional, integers 1–8192; explicit output size capped at 25 MP, and worker enforces configurable decoded/output pixel limit. Quality 1–100, default 82. Format `jpeg|png|webp`, default WebP. Rotation `0|90|180|270` clockwise. Watermark optional, at most 80 characters. Unknown transformation keys are rejected. Duplicate upload IDs within one request are deduplicated. Separate submissions intentionally create separate jobs; this API does not provide client request-idempotency headers.

Files must have matching extension, multipart MIME and decoded signature, with JPEG, PNG or WebP content. Default size 10 MB each (configurable up to 25 MB), eight files maximum, single frame, default 25 MP. Client fields cannot select object keys, buckets, filesystem paths or external fetch URLs. The API reads metadata with Sharp; Python subsequently verifies the full image, so corruption discovered during processing becomes a permanent failed job. Do not label metadata-only validation a complete decode.

An upload record includes id, original filename, MIME, compressed size, width, height, createdAt, and temporary preview URL. Job fields include UUID, transformations, status, progress, attempt count, generation, timestamps, safe error, processing duration in milliseconds, upload metadata, output dimensions/size/format and audit trail. Internal S3 keys are omitted from serialized responses. A complete result may increase file size; negative savings are valid.

### Errors

```json
{"error":{"message":"Service temporarily unavailable. Please try again.","requestId":"request-uuid"}}
```

400 validation, 404 unknown UUID/expired upload, 409 invalid state or unsupported cancellation, 410 expired result, 413 upload limit, 429 rate limit, 503 dependency failure. General infrastructure errors do not expose credentials, SQL or internal exception messages. Each response carries `X-Request-Id`. Default API limit 300 requests/minute per client; upload endpoint additionally 20/minute. Nginx accepts up to 84 MB per request to accommodate an eight-image 10 MB batch; increase both proxy limits and container memory if increasing app limits.

### SSE and polling fallback

```js
const events = new EventSource(`/api/v1/jobs/${jobId}/events`);
events.addEventListener('job', e => console.log(JSON.parse(e.data)));
events.onerror = () => { events.close(); /* poll GET /jobs/:id every 2s */ };
```

SSE exposes actual state, closes at terminal state, caps 50 concurrent API-process streams and bounds lifetime. A client should stop/reconnect after two minutes if still active, or switch to polling. The shipped UI deliberately uses polling, so proxy/SSE support is optional and status remains consistent. History/statistics poll every five seconds. Preview links are temporary and refreshed on a new detail fetch. Signed download links must be fetched immediately before use.
