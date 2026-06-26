# Production Operational Smoke And Error Signals

## Sorumluluk

Bu belge MS-019F bounded 20-minute operational-smoke ve same-window machine-safe error-signal handoff-v2 contract'inin, R2/R3/R4 blocked audit trail'inin ve R5 governance-approved closeout'unun canonical repository-local sahibidir.

MS-019F v1 24-hour handoff governance tarafindan emekliye ayrildi ve historical external artifact olarak yalniz su class ile korunur:

```text
HISTORICAL_SUPERSEDED_GOVERNANCE_REJECTED_NEVER_RUN
```

Fresh operator run icin v1 kullanilmaz. Handoff generation production evidence degildir; Codex production'a baglanmaz, observer calistirmaz ve returned bundle kabul etmez. Current production activation status ve accepted receipt identity [production-acceptance.md](production-acceptance.md) dosyasindadir.

## Governance Boundary

Accepted MS-019F scope yalniz bounded 20-minute operational smoke ve ayni pencere error/fatal aggregate'idir.

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

Original technical strict acceptance final elapsed `>=1200`, all sample indices present, all bucket intervals present, max lag `<=15`, all health/worker/container gates passed ve error/fatal signal totals zero ister. MS-019F-R5 bu strict verifier'i silmez veya gevsetmez; strict result v3 icin `BLOCKED_ERROR_SIGNAL_BUCKET_SPAN_MISMATCH` olarak korunur.

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

## MS-019F-R5 Governance-Accepted Current Evidence

Governance-approved current acceptance exact fresh v3 returned bundle'a pinlidir; bu bir genel verifier gevsetmesi veya future-bundle bypass degildir.

- Selected v3 tree digest: `0ddc2021486d039718ca7d9350c0fca2f3bf6e467d8d01b1c9f087343c19c183`
- Authority-v3 SHA-256: `ea229cfd06862b293f64c63ddf4d2171b9e83be1d94afce21bcc746e004e97d3`
- Governance decision record: `production-operational-smoke-governance-decision-v1.json`
- Governance decision SHA-256: `86d2f21ae78418cc00312ca4a18f6417cb2df4fb7314341d40b9c5ef344aed73`
- Receipt-v4: `production-operational-smoke-receipt-v4.json`
- Receipt-v4 SHA-256: `4146d93b99776f2d11c603b57dc60e728942c4fc56fbd8b8f5a41c2077acaa27`
- Outcome: `SUCCESS_GOVERNANCE_ACCEPTED`
- Acceptance basis: `GOVERNANCE_APPROVED_SAMPLE_TIMELINE_BASELINE_V1`

Authoritative acceptance time source:

- primary samples: `21`, indices `0..20`
- first-to-last primary sample UTC span: `1200` seconds
- max scheduling lag: `0` seconds in the selected v3 bundle
- worker health due checks: `5/5` passed
- error buckets: `20 API + 20 worker`, ordinal indices `0..19` complete
- warning/error/fatal totals: `0 / 0 / 0`

Non-gating diagnostics preserved in receipt-v4:

- metadata start/end UTC delta: `63` seconds while metadata elapsed is `1203`
- bucket UTC span min/max: `59 / 61`
- bucket UTC span anomaly count: `12`
- original technical strict result: `BLOCKED_ERROR_SIGNAL_BUCKET_SPAN_MISMATCH`

Non-waivable gates remain strict: exact handoff/freeze/authority identity, returned checksums, schema/contract, production mode, no test acceleration, health/dependency/TLS `21/21`, API/worker continuity, worker health, ordinal bucket coverage, zero error/fatal totals, no raw logs, no auth, no retry, concurrency `1`, no mutation/deploy/restart/migration/backup/restore.

Governance verifier commands are local-only:

```powershell
npm run production:operational-smoke:governance-decision:verify -- --evidence-dir <selected-v3-returned-dir>
npm run production:operational-smoke:governance:verify -- --evidence-dir <selected-v3-returned-dir> --require-governance-approved-smoke-baseline
npm run production:operational-smoke:receipt-v4:verify -- --evidence-dir <selected-v3-returned-dir> --require-governance-approved-smoke-baseline
```

Future runtime mutations must not automatically reuse the R5 time-anomaly exception. Use the then-current bounded smoke contract and any explicit governance policy that exists at that time.

## Status Boundary

MS-019F is closed for current production operational evidence by R5 governance acceptance:

- bounded operational-smoke evidence: `SUCCESS_GOVERNANCE_ACCEPTED`
- bounded error-signal evidence: `SUCCESS_GOVERNANCE_ACCEPTED`
- long-term stability evidence: `NOT_APPLICABLE_BY_GOVERNANCE_DECISION`
- historical previous production pointer: `NON_BLOCKING_HISTORICAL_EVIDENCE_GAP`
- accepted production status: unchanged, `MVP - Production Aktif`

Receipt-v4 must not be used to infer future production success from local fixture output, staging evidence, Git commit identity, point-in-time health or prior operational receipts.
