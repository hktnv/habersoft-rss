# Production Operational Smoke And Error Signals

## Sorumluluk

Bu belge MS-019F-R1 bounded 20-minute operational-smoke ve same-window machine-safe error-signal handoff-v2 contract'inin canonical repository-local sahibidir.

MS-019F v1 24-hour handoff governance tarafindan emekliye ayrildi ve historical external artifact olarak yalniz su class ile korunur:

```text
HISTORICAL_SUPERSEDED_GOVERNANCE_REJECTED_NEVER_RUN
```

Fresh operator run icin v1 kullanilmaz. Handoff generation production evidence degildir; Codex production'a baglanmaz, observer calistirmaz ve returned bundle kabul etmez. Current production activation status ve accepted receipt identity [production-acceptance.md](production-acceptance.md) dosyasindadir.

## Governance Boundary

Accepted MS-019F-R1 scope yalniz bounded 20-minute operational smoke ve ayni pencere error/fatal aggregate'idir.

- window class: `BOUNDED_20M_OPERATIONAL_SMOKE`
- long-term stability claim: `false`
- long-term stability status: `NOT_APPLICABLE_BY_GOVERNANCE_DECISION`
- no uptime SLO, reliability claim, alerting proof, metric retention proof or historical zero-error claim

Bu belge yeni long-term stability residual'i acmaz.

## Observation Contract

Observation contract closed degerlerle pinlenir:

- window: `20` minutes / `1200` seconds
- primary interval: `60` seconds
- primary samples: `21`, indices `0..20`
- worker-health interval: `300` seconds
- worker-health samples: `5`, indices `0..4`
- error bucket seconds: `60`
- error buckets: `20`, indices `0..19`
- max scheduling lag: `15` seconds
- concurrency: `1`
- retry: `false`
- production mutation: `false`

Strict acceptance ancak final elapsed `>=1200`, all sample indices present, all bucket intervals present, max lag `<=15`, all health/worker/container gates passed ve error/fatal signal totals zero ise mumkundur.

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

## Container And Error Signal

Observer API ve worker container'lari icin safe identity token, image ID, restart count, `OOMKilled` ve `StartedAt` degerlerini pinler. Container replacement, non-running state, restart count/started-at change, OOMKilled true veya image ID change strict receipt'i bloke eder.

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

## Handoff And Verifier

Repository-local tooling:

```powershell
npm run production:operational-smoke:source:verify
npm run production:operational-smoke:handoff -- --output-dir <external-handoff-dir>
npm run production:operational-smoke:handoff:verify -- --handoff-dir <external-handoff-dir>
npm run production:operational-smoke:handoff:freeze -- --handoff-dir <external-handoff-dir> --freeze-file <external-freeze-file> --fixture-result PASSED
npm run test:production-operational-smoke-evidence
```

Generated handoff-v2 inventory:

```text
README.md
observe-production-operational-smoke.sh
operational-smoke-contract.json
manifest.json
checksums.sha256
```

Freeze binds the final landed source commit, manifest SHA-256, observer SHA-256, contract SHA-256, window constants, governance boundary, classifier mode/version, LF/bash/static-safety verification and generated fixture result. Freeze does not claim production contact or production evidence collection.

## Operator Command

Operator verifies the bundle:

```bash
cd <approved-ms-019f-handoff-v2-dir>
sha256sum -c checksums.sha256
bash -n observe-production-operational-smoke.sh
```

Operator runs the observer from production host:

```bash
cd /opt/habersoft-rss

<approved-ms-019f-handoff-v2-dir>/observe-production-operational-smoke.sh \
  --repository-dir /opt/habersoft-rss \
  --compose-file deploy/production/compose.yaml \
  --shared-env .env.production \
  --runtime-image-env deploy/runtime-image.env \
  --confirm-window-minutes 20 \
  --confirm-public-host rss.habersoft.com \
  --output-dir <new-empty-output-dir>
```

The output directory must be new or empty. Interrupted runs have no valid final checksum bundle and must be rerun from the beginning. `bash -x`, deployment, restart, migration, backup, restore, env edit, edge edit and raw log review are outside this observer.

## Returned Bundle

Returned bundle must be flat and exactly:

```text
checksums.sha256
collector-metadata.txt
operational-smoke-samples.tsv
error-signal-buckets.tsv
```

Unknown files, symlinks, checksum mismatch, CRLF, secret-shaped content, raw logs, raw response bodies, env files, Docker inspect JSON or unknown fields are rejected by local intake.

Receipt creation and strict verification are local-only:

```powershell
npm run production:operational-smoke:receipt:create -- --handoff-dir <external-handoff-dir> --freeze-file <external-freeze-file> --evidence-dir <returned-evidence-dir> --receipt-file <external-receipt-file>
npm run production:operational-smoke:receipt:verify -- --receipt-file <external-receipt-file> --require-bounded-operational-smoke --require-bounded-error-signal --require-ms019f-v2-baseline
```

## Status Boundary

MS-019F-R1 prepared tooling closes the handoff/verifier gap only. Until a real returned bundle is collected and strictly verified:

- bounded operational-smoke evidence: `PENDING_OPERATOR_RUN`
- bounded error-signal evidence: `PENDING_OPERATOR_RUN`
- long-term stability evidence: `NOT_APPLICABLE_BY_GOVERNANCE_DECISION`
- historical previous production pointer: unchanged, `NOT_RECORDED`
- accepted production status: unchanged, `MVP - Production Aktif`

This handoff must not be used to infer production success from local fixture output, staging evidence, Git commit identity, point-in-time health or prior operational receipts.
