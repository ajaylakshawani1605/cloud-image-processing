# Five-minute academic demo

Prepare first: install Docker, build/start with `docker compose --profile monitoring up --build -d`, confirm readiness, open dashboard/Swagger/Grafana tabs, generate fixtures, and keep worker logs visible. Kubernetes scaling requires KEDA installed and enough local RAM; prepare that cluster before the timed demo. First builds/installations are not part of the five minutes.

| Time | Action | Explain |
| --- | --- | --- |
| 0:00–0:40 | Open Architecture, click through Client → Gateway → API → Queue → Worker → Storage → Monitoring → Result | Eight modules and why expensive processing is outside the request |
| 0:40–1:30 | Process Images → generated demo image, add another image, resize to 640, choose WebP, grayscale or watermark, submit | Real multipart validation, private original storage, 202 acceptance, queued metadata |
| 1:30–2:15 | Follow processing/completed, inspect previews, dimensions/savings/time, download | Pillow transformed actual bytes; short-lived URL exposes no secret; small jobs may complete before next poll |
| 2:15–3:00 | Job History: search/filter, open details/audit; Dashboard/Monitoring; Grafana charts | PostgreSQL persistence, real queue counts, latency/throughput metrics, JSON logs with job UUID |
| 3:00–4:00 | Run `npm run load`; show `LLEN bull:images:wait`, KEDA HPA and worker replicas | Scaling actual combined Node/Python pods; wait-list signal and one minimum consumer |
| 4:00–5:00 | Show an upload rejection; demonstrate previously prepared worker crash or retry audit; restart worker if paused | Permanent vs retryable failure, lock renewal, exponential retry, idempotent output and durable completion |

For a guaranteed queued-state explanation in Compose, deliberately `docker compose stop worker` before submission, show queued status, then `docker compose start worker`. This is a visible real failure injection, not fabricated metrics. For a transient retry, stop MinIO only in the isolated demo environment and restore it promptly; attempts may exhaust if it remains unavailable. A worker crash may require roughly two minutes to expire its lock, so prepare the crash before the timed segment and explain its timestamps rather than claiming instant recovery.

Scaling fallback if no cluster: show Compose worker replicas and the supplied KEDA configuration, explicitly state that Kubernetes autoscaling has not been demonstrated. A short batch may finish before the HPA reacts; increase the bounded load or show collected real measurements. Do not claim replica changes that were not observed.

Talking points: API request returns before processing; Redis handles reservation rather than Python reading queue keys; every generation has deterministic object/queue keys; acknowledgments follow storage PUT and database commit; signed URLs expire; data volumes survive service restarts; KEDA reads a backlog metric and scales workers; readiness controls traffic while liveness permits restart. Cancellation is explicitly unsupported rather than offered unsafely.
