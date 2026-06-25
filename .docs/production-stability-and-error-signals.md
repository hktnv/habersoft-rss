# Production Stability And Error Signals

## Sorumluluk

Bu belge MS-019F bounded 24-hour production stability ve machine-safe error-signal evidence handoff contract'inin canonical repository-local sahibidir.

MS-019F hazirligi production evidence accepted anlamina gelmez. Handoff bundle ve verifier repository'de hazirlanir; operator daha sonra production host uzerinde read-only observer'i calistirir ve returned bundle'i local intake icin geri verir. Current production activation status ve accepted receipt identity [production-acceptance.md](production-acceptance.md) dosyasindadir; bu belge o status'u genisletmez.

## Observation Contract

Observation contract closed degerlerle pinlenir:

- window: `24h` / `86400` seconds
- primary interval: `300` seconds
- primary samples: `289`, indices `0..288`
- worker-health interval: `1800` seconds
- worker-health samples: `49`, indices `0..48`
- error buckets: `288`, intervals `[sample_i, sample_i+1)`
- max primary scheduling lag: `60` seconds
- concurrency: `1`
- retry: `false`
- production mutation: `false`

Strict acceptance ancak final elapsed `>=86400`, all sample indices present, all bucket intervals present, max lag `<=60`, all health/worker/container gates passed ve error/fatal signal totals zero ise mumkundur.

## Health And Worker Sampling

Primary health samples read-only ve unauthenticated calisir:

- `GET http://127.0.0.1:3200/health/live` -> HTTP `200`, status `live`
- `GET http://127.0.0.1:3200/health/ready` -> HTTP `200`, status `ready`, `postgres=up`, `redis=up`, `tenantAuth=up`
- `GET https://rss.habersoft.com/health/live` -> HTTP `200`, status `live`, TLS verification enabled
- `GET https://rss.habersoft.com/health/ready` -> HTTP `200`, status `ready`, dependencies `up`, TLS verification enabled

Observer auth header, cookie, retry, TLS bypass, raw response-body retention veya header retention kullanmaz.

Worker health read-only command:

```sh
docker compose --env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}" exec -T main-service-worker npm run worker:health
```

Expected worker contract:

- queue: `main-service.maintenance`
- scheduler: `cleanup.daily`
- job: `cleanup.run.v1`
- timezone: `UTC`
- global concurrency: `1`
- local concurrency: `1`

`docker compose run` bu evidence class'inda yasaktir.

## Container Stability

Observer API ve worker container'lari icin safe identity token, image ID, restart count, `OOMKilled` ve `StartedAt` degerlerini pinler. Container replacement, non-running state, restart count/started-at change, OOMKilled true veya image ID change strict receipt'i bloke eder.

Full Docker inspect JSON, container env projection veya raw host-private data retained edilmez.

## Machine-Safe Error Signal

MS-019F broad log grep yapmaz. Classifier mode:

```text
STABLE_SEVERITY_PREFIX
```

Classifier only source-owned, machine-safe severity prefixesini sayar:

- Nest default severity token: `[Nest] ... ERROR`, `[Nest] ... WARN`, `[Nest] ... FATAL`
- bootstrap failure prefixes: `main-service-api bootstrap failed`, `main-service-worker bootstrap failed`, `main-service-worker-health bootstrap failed`
- runtime config prefix: `Invalid runtime configuration:`
- direct warning prefix: `tenant auth JWKS refresh failed: ...`
- cleanup telemetry failed-step JSON signal

Arbitrary messages containing the word `error` counted edilmez. Raw logs, line hashes, samples veya snippets output'a yazilmaz. Docker logs stream'i direct classifier'a pipe edilir ve sadece count bucket'lari retained edilir.

Supported Docker log driver classes:

- `DOCKER_JSON_FILE`
- `DOCKER_LOCAL`

Unsupported log collection, unsupported driver, incomplete coverage, classifier mismatch, error count `>0` veya fatal count `>0` strict receipt'i fail-closed bloke eder.

## Handoff And Verifier

Repository-local tooling:

```powershell
npm run production:stability:source:verify
npm run production:stability:handoff -- --output-dir <external-handoff-dir>
npm run production:stability:handoff:verify -- --handoff-dir <external-handoff-dir>
npm run production:stability:handoff:freeze -- --handoff-dir <external-handoff-dir> --freeze-file <external-freeze-file> --fixture-result PASSED
npm run test:production-stability-evidence
```

Generated handoff-v1 inventory:

```text
README.md
observe-production-stability.sh
stability-observation-contract.json
manifest.json
checksums.sha256
```

Freeze binds the final landed source commit, manifest SHA-256, observer SHA-256, contract SHA-256, window constants, classifier mode/version, LF/bash/static-safety verification and generated fixture result. Freeze does not claim production contact or production evidence collection.

## Operator Command

Operator verifies the bundle:

```bash
cd <approved-ms-019f-handoff-v1-dir>
sha256sum -c checksums.sha256
bash -n observe-production-stability.sh
```

Operator runs the observer from production host:

```bash
cd /opt/habersoft-rss

<approved-ms-019f-handoff-v1-dir>/observe-production-stability.sh \
  --repository-dir /opt/habersoft-rss \
  --compose-file deploy/production/compose.yaml \
  --shared-env .env.production \
  --runtime-image-env deploy/runtime-image.env \
  --confirm-window-hours 24 \
  --confirm-public-host rss.habersoft.com \
  --output-dir <new-empty-output-dir>
```

The output directory must be new or empty. Interrupted runs have no valid final checksum bundle and must be rerun from the beginning. `bash -x`, deployment, restart, migration, backup, restore, env edit, edge edit and raw log review are outside this observer.

## Returned Bundle

Returned bundle must be flat and exactly:

```text
checksums.sha256
collector-metadata.txt
stability-samples.tsv
error-signal-buckets.tsv
```

Unknown files, symlinks, checksum mismatch, CRLF, secret-shaped content, raw logs, raw response bodies, env files, Docker inspect JSON or unknown fields are rejected by local intake.

Receipt creation and strict verification are local-only:

```powershell
npm run production:stability:receipt:create -- --handoff-dir <external-handoff-dir> --freeze-file <external-freeze-file> --evidence-dir <returned-evidence-dir> --receipt-file <external-receipt-file>
npm run production:stability:receipt:verify -- --receipt-file <external-receipt-file> --require-ms019f-baseline
```

## Status Boundary

MS-019F prepared tooling closes the handoff/verifier gap only. Until a real returned bundle is collected and strictly verified:

- bounded 24-hour stability evidence: `NOT_RECORDED`
- bounded error-signal evidence: `NOT_RECORDED`
- long-term uptime/SLO evidence: `NOT_RECORDED`
- historical previous production pointer: unchanged, `NOT_RECORDED`
- accepted production status: unchanged, `MVP - Production Aktif`

This handoff must not be used to infer production success from local fixture output, staging evidence, Git commit identity, point-in-time health or prior operational receipts.
