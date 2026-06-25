# Production Operational Evidence

## Sorumluluk

Bu belge `main-service` production operational evidence contract, read-only operator collector/handoff akisi, returned evidence bundle modeli ve receipt verifier semantiginin canonical repository-local sahibidir. Current accepted contract MS-019B-R8 `production-operational-evidence-v2` sozlesmesidir; MS-019A handoff-v1 historical verification icin korunur.

Bu belge current production activation status sahibi degildir. Current status ve MS-018C receipt identity [production-acceptance.md](production-acceptance.md) dosyasindadir.

MS-019B-R8 returned collector-v2 evidence local olarak intake edildi. Codex production sunucusuna baglanmadi, production servisini degistirmedi, backup/restore yapmadi ve release publication karari uretmedi.

## Boundary

MS-019B sonucunda hazirlanan tooling:

- external operator handoff bundle uretir,
- generated bundle manifest/checksum/secret/forbidden-command kapilarini dogrular,
- operator tarafindan daha sonra uretilecek returned evidence bundle'i parse edebilecek receipt modelini tanimlar,
- external JSON operational receipt'i dogrular,
- partial evidence ile full operational baseline'i ayirir.

Handoff tooling hazir olmasi `production evidence collected` anlamina gelmez. MS-019B-R8 operational receipt external ve untracked olarak olusturuldu; yalniz receipt tarafindan kanitlanan alanlar repository-local status dokumanlarina yansitilir.

## Compose Context Contract

Production operational evidence collector-v2 yalniz explicit production Compose context ile calisir:

```sh
docker compose --env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}" <subcommand>
```

Bare `docker compose ...` production evidence command'i degildir. Repository root `compose.yaml` local/default model icindir; production evidence collector'i `deploy/production/compose.yaml`, external shared production env dosyasi ve `deploy/runtime-image.env` image identity layer'ini birlikte kullanir.

Collector-v2 input contract:

- `--repository-dir <production-repository-root>`
- `--compose-file deploy/production/compose.yaml`
- `--shared-env .env.production`
- `--runtime-image-env deploy/runtime-image.env`
- `--output-dir <new-empty-output-dir>`

Relative file paths production repository root altinda cozulur. Shared env dosyasi okunur ama secret degerleri echo edilmez veya output'a yazilmaz. Runtime image env allowlist'i yalniz `MAIN_SERVICE_IMAGE` alanini identity kaniti olarak kaydeder.

Collector once `compose_context.result` preflight'ini `docker compose --env-file ... --env-file ... -f ... config --services` ile sinar. Bu preflight `BLOCKED` olursa dependent Compose kontrolleri mutation yapmadan durur; migration ve worker health `FAILED` degil `NOT_RUN` olarak siniflanir. Bu ayrim, invocation-context hatasi ile gercek production runtime failure'ini karistirmamak icindir.

## Exact Runtime Identity Model

Production runtime identity yalniz current server checkout veya latest `origin/main` uzerinden kurulmaz. Receipt alanlari ayridir:

- `server_checkout_commit`
- `local_origin_main_ref`
- `runtime_image_env_image_id`
- `api_running_image_id`
- `worker_running_image_id`
- `inspected_image_id`
- `running_image_revision_label`
- `running_image_source_label`
- `server_checkout_matches_running_revision`

Full identity zinciri icin `runtime-image.env`, API container image ID, worker container image ID, inspected image ID ve OCI revision/source label ayni chain icinde dogrulanir. Runtime revision canonical repository history'sinde bulunmali ve verified `origin/main` ancestor'i olmalidir.

Staging package source commit, staging image ID, MS-018C docs commit, local Codex safe base, production acceptance receipt hash veya master documentation hash production runtime identity kaniti degildir.

## Service And Port Model

Expected production service inventory:

- `postgres`
- `redis`
- `migrate`
- `main-service-api`
- `main-service-worker`

Steady-state modelde `postgres`, `redis`, API ve worker running/healthy sinifindadir. `migrate` finite roldur ve surekli running olmasi operational blocker olarak siniflanir.

Expected port policy:

- API container port `3000`
- API host bind yalniz `127.0.0.1:3200`
- worker host port yok
- PostgreSQL host port yok
- Redis host port yok

Unexpected service, public DB/Redis/worker port veya non-loopback API bind `FAILED` olur; `NOT_RECORDED` olarak yumusatilmaz.

Docker port projection'da `5432/tcp=` veya `6379/tcp=` gibi host binding'i bos olan satirlar public host port yayinlandigi anlamina gelmez. Receipt verifier host binding parcasini parse eder; `0.0.0.0:5432` veya benzeri gercek host binding'i ise hard failure olarak kalir.

## Migration, Worker And Scheduler

Migration receipt'i expected migration inventory'yi korur:

- `20260620000000_initial_empty`
- `20260620001000_canonical_business_schema`

Migration probe read-only sinifta kalir. Pending veya failed migration `FAILED` sayilir. Raw Prisma output receipt'e yazilmaz; gerekirse bounded classification ve output SHA-256 kullanilir.

Worker contract:

- queue: `main-service.maintenance`
- job: `cleanup.run.v1`
- scheduler: `cleanup.daily`
- timezone: `UTC`
- global concurrency: `1`
- local concurrency: `1`

`DIRECT_OBSERVED`, production worker/scheduler evidence'in machine-parse edildigini gosterir. `CONTRACT_DERIVED`, repository contract'inin bilindigini ama production scheduler'in direct observed olmadigini gosterir. Worker health direct scheduler evidence anlamina otomatik gelmez.

## Health, Boundary, Redirect And TLS

Internal health checks:

- `GET http://127.0.0.1:3200/health/live` -> HTTP `200`, status `live`
- `GET http://127.0.0.1:3200/health/ready` -> HTTP `200`, status `ready`, `postgres=up`, `redis=up`, `tenantAuth=up`

Public checks:

- `GET https://rss.habersoft.com/health/live` -> HTTP `200`, status `live`
- `GET https://rss.habersoft.com/health/ready` -> HTTP `200`, status `ready`, dependencies `up`

Unauthenticated boundary checks:

- `GET https://rss.habersoft.com/not-found` -> `404`
- `GET https://rss.habersoft.com/api/feeds` -> `401`
- `GET https://rss.habersoft.com/agent/feeds/due?limit=1` -> `401`

HTTP redirect check uses GET without following redirects and only passes if canonical HTTPS `Location` is proven.

TLS receipt contains only public metadata: verification status, SHA-256 fingerprint, validity dates, hostname match and tool availability. Certificate PEM, chain body or TLS private material is not recorded.

## Stability Claim Boundary

Restart/OOM fields are point-in-time Docker state snapshots only:

- API restart count, OOMKilled, state and start time
- worker restart count, OOMKilled, state and start time

These fields do not prove long-term stability, absence of error bursts, uptime SLO, alerting, metric retention or log pipeline. `error_burst` remains `NOT_RECORDED` in this contract slice.

## Handoff And Receipt Flow

Local MS-019B handoff-v2 generation:

```powershell
npm run production:evidence:handoff -- --output <external-handoff-dir>
npm run production:evidence:handoff:verify -- --bundle <external-handoff-dir>
```

Operator collection v2 command shape:

```sh
cd /opt/habersoft-rss
<approved-handoff-v2>/collect-production-operational-evidence.sh \
  --repository-dir /opt/habersoft-rss \
  --compose-file deploy/production/compose.yaml \
  --shared-env .env.production \
  --runtime-image-env deploy/runtime-image.env \
  --output-dir <new-empty-output-dir>
```

Local receipt creation and verification:

```powershell
node scripts/production-operational-evidence.mjs receipt:create --evidence <external-collected-dir> --output <external-receipt>
npm run production:evidence:receipt:verify -- --receipt <external-receipt>
npm run production:evidence:receipt:verify -- --receipt <external-receipt> --require-operational-baseline
```

Default receipt verification proves structure, checksums, field allowlist, secret/privacy gates and fail-closed semantics. `--require-operational-baseline` additionally rejects partial evidence.

## Status Semantics

Allowed receipt vocabulary is closed:

- `PASSED`
- `FAILED`
- `NOT_RECORDED`
- `NOT_APPLICABLE`
- `TOOL_UNAVAILABLE`
- `PARTIAL`
- `BLOCKED`
- `DIRECT_OBSERVED`
- `CONTRACT_DERIVED`
- `NOT_RUN`

Valid partial receipt is not a full operational baseline. Examples of partial evidence are unavailable TLS tooling, absent previous pointer, scheduler output that cannot be direct parsed or missing revision label. `NOT_RUN` is reserved for dependent probes intentionally skipped after context preflight failure. For MS-019B-R8 acceptance, a blocked Compose context is not acceptable. Hard failures include image mismatch, wrong OCI source, public DB/Redis/worker port, failed migration, failed worker health, protected unauthenticated route returning 2xx, TLS verification failure or mutation/publication flag set to true.

MS-019B-R8 receipt result:

- Receipt filename: `production-operational-evidence-receipt.json`
- Receipt SHA-256: `3a5624a5cab3044a1797d9c8ee78e92828a28233a67f759b8bf6845a7ecc4620`
- Authority record: `returned-bundle-authority-v6.json`
- Authority SHA-256: `0dcc623da1442fc7383f0f3c42723e7403992ac852e39802db48ec79033e4771`
- Returned tree digest: `794b760e98628864773caa109dd8ab5e1c92fa1556e7fa6c3d16827ae55298a9`
- Structural verifier: `PASSED`
- Full operational baseline verifier: `PARTIAL`, because previous production pointer fields remain `NOT_RECORDED`
- Production mutation/deploy/backup/restore/publication flags: `false`

## Secret And Privacy Gates

Generated handoff, returned evidence bundle and receipt verifier reject secret-shaped data, raw environment content, private key material, token-looking values, raw logs, raw request bodies, full Docker inspect environment projection, package/image archives, backup dumps, private operator paths and private host/user details.

Canonical public values allowed in this evidence contract are the canonical repository URL, `https://rss.habersoft.com`, `127.0.0.1:3200`, known service/route names, Git SHA values, Docker image IDs and public TLS fingerprint/expiry metadata.

## Out Of Scope

The following remain outside the accepted MS-019B-R8 receipt:

- edge body-limit verification,
- long-running stability observation,
- raw log/error-burst analysis,
- dashboard, metrics backend or alerting,
- registry publication,
- Git tag,
- GitHub Release.

These fields stay `NOT_RECORDED` or `NOT_PERFORMED` until a later bounded milestone records evidence.

MS-019C owns the production PostgreSQL backup and off-host disposable restore evidence contract. MS-019C returned backup-v2 intake is now accepted as `PRODUCTION_BACKUP_RESTORE_VERIFIED` with combined receipt SHA-256 `868b13b9cfe44962daa4abbec71310473e1df1d0a49e4bf156a4c3f77ed01735`. Raw dump files, capture metadata and restore receipts are external sensitive artifacts and are never part of the MS-019B operational evidence bundle. MS-019B receipt SHA-256 remains the parent identity for the combined MS-019C receipt.

MS-019D owns the production checkout hygiene and release-pointer evidence handoff contract in [production-checkout-and-release-pointers.md](production-checkout-and-release-pointers.md). MS-019D tooling does not change the MS-019B receipt result and does not convert previous pointer `NOT_RECORDED` into passed evidence; it prepares the operator-run read-only collector and local verifier for a future returned bundle.

## Historical Handoff Boundary

MS-019A handoff-v1 remains historically verifiable by the handoff verifier. New operator reruns must use the collector-v2 contract so the production Compose context, two env-file layers, context preflight and `NOT_RUN` dependent classification are present in the returned bundle.
