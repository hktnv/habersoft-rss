# Yerel Gelistirme

## On Kosullar

- Docker Engine ve Docker Compose.
- Git.
- Host uzerinde Node.js, PostgreSQL veya Redis kurulumu gerekli degildir.

## Environment Dosyasi

```powershell
Copy-Item .env.example .env
```

`.env.example` yalnizca yerel gelistirme icin placeholder degerler tasir. Gercek secret veya uretim credential'i commit edilmez.

## Build, Start, Stop ve Reset

```powershell
docker compose build
docker compose up -d
docker compose down
docker compose down -v
```

`docker compose down -v` PostgreSQL named volume'unu da siler ve yerel veriyi sifirlar. Normal `down` veya image rebuild PostgreSQL verisini silmez.

## Servis Rolleri

- `postgres`: PostgreSQL 17.9 local kalici veri servisi.
- `redis`: Redis 8.8 local yeniden kurulabilir runtime servisi.
- `tenant-auth-jwks-fixture`: Local-only deterministik olmayan, ephemeral RS256 public JWKS fixture servisi. Host portu yayimlamaz; yalnizca Compose agi icinden kullanilir.
- `migrate`: PostgreSQL saglikli olduktan sonra `prisma migrate deploy` calistiran sonlu gorev.
- `main-service-api`: NestJS HTTP API process'i. Health endpoint'lerini, tenant auth/JWKS lifecycle'ini, tenant feed abonelik endpoint'lerini, tenant entry listeleme/detail endpoint'lerini, API-only tenant rate limiting guard'ini, Agent `X-Agent-Key` auth provider'larini, `POST /agent/heartbeat`, `GET /agent/feeds/due`, `POST /agent/feeds/{feed_id}/new-guids`, `POST /agent/entries` ve `POST /agent/feed-check-results` route'larini baslatir.
- `main-service-worker`: HTTP listener acmayan Nest application context. Config, PostgreSQL ve Redis baglantilarini bootstrap eder; BullMQ maintenance queue consumer'ini, `cleanup.daily` scheduler reconciliation'i ve `cleanup.run.v1` retention job'unu calistirir. Tenant auth/JWKS lifecycle'i, Agent auth provider'lari veya public HTTP route baslatmaz.

## Sabit Image Surumleri

- Application image base: `node:24.17.0-bookworm-slim`
- PostgreSQL: `postgres:17.9-bookworm`
- Redis: `redis:8.8.0-trixie`

## Tenant Auth Local Fixture

Local Compose varsayilaninda API, `TENANT_AUTH_JWKS_URL=http://tenant-auth-jwks-fixture:3080/.well-known/jwks.json` adresini kullanir. Fixture servis her container baslangicinda ephemeral RSA keypair olusturur ve yalnizca public JWKS yayimlar. Private key dosyaya yazilmaz, host portu acilmaz ve gercek auth-service bagimliligi olusturmaz.

Production ortaminda fixture veya `http://` JWKS URL'i kabul edilmez. Gercek uretim JWKS adresi `https://` olmalidir ve local fixture hostname'ine isaret edemez.

## Tenant Rate Limit Local Ayarlari

Local Compose varsayilani Tenant API feed rotalari icin tenant basina `60` istek / `60` saniye kotasi uygular.

```text
TENANT_RATE_LIMIT_MAX_REQUESTS=60
TENANT_RATE_LIMIT_WINDOW_SECONDS=60
TENANT_RATE_LIMIT_REDIS_PREFIX=tenant_rate_limit:local
TENANT_RATE_LIMIT_KEY_SECRET=replace_with_local_only_rate_limit_key_secret_32
```

Production ortaminda `TENANT_RATE_LIMIT_KEY_SECRET` acik ve guclu bir deger olmalidir; local placeholder kabul edilmez.

## Agent Auth Local Ayari

Local Compose varsayilani yalniz `main-service-api` container'ina Agent API key placeholder'ini verir:

```text
AGENT_KEY=replace_with_local_only_agent_key_at_least_32_bytes
```

Worker, migrate ve local JWKS fixture container'lari `AGENT_KEY` almaz. Production ortaminda bu placeholder, bos/whitespace degerler, 32 UTF-8 byte altindaki degerler, leading/trailing whitespace ve ASCII control character iceren degerler reddedilir.

MS-013 itibariyla `X-Agent-Key` ile korunan production Agent route'lari `POST /agent/heartbeat`, `GET /agent/feeds/due`, `POST /agent/feeds/{feed_id}/new-guids`, `POST /agent/entries` ve `POST /agent/feed-check-results` route'laridir. Agent key Tenant API rotalarini acmaz.

## Agent Entry Ingestion Local Ayarlari

Local Compose varsayilani yalniz `main-service-api` container'ina `checked_at` kabul penceresi verir:

```text
CHECKED_AT_MAX_FUTURE_SKEW_SECONDS=60
CHECKED_AT_MAX_AGE_SECONDS=900
```

Worker, migrate ve local JWKS fixture container'lari bu ayarlari almaz.

## Cleanup Job Runner Local Ayarlari

Local Compose varsayilani yalniz `main-service-worker` container'ina cleanup/job-runner ayarlarini verir:

```text
ENTRY_RETENTION_DAYS=30
ENTRY_MAX_PER_FEED=10000
ENTRY_DETAIL_RETENTION_DAYS=7
ENTRY_DETAIL_MAX_PER_FEED=2000
BULLMQ_PREFIX=main-service-local
MAINTENANCE_COMPLETED_JOB_RETENTION_SECONDS=604800
MAINTENANCE_COMPLETED_JOB_MAX_COUNT=1000
MAINTENANCE_FAILED_JOB_RETENTION_SECONDS=2592000
MAINTENANCE_FAILED_JOB_MAX_COUNT=5000
```

Queue registry ve scheduler davranisi icin bkz. [background-job-runner.md](background-job-runner.md). Retention SQL davranisi icin bkz. [cleanup-retention.md](cleanup-retention.md).

## Agent Heartbeat

Local smoke icin secret degeri yazdirmadan authenticated heartbeat gondermek gerekir. Tercih edilen dogrulama komutu:

```powershell
docker compose run --rm main-service-api npm run test:agent-heartbeat
```

`POST /agent/heartbeat`, yalniz `agent_runtime_status` current-state satirini upsert eder ve exact `{ "ok": true }` dondurur. `feeds`, `entries`, `entry_details`, `site_feeds`, `agent_feed_check_events`, scheduler state veya Redis/JWKS/network hattina dokunmaz.

## Agent Due Feeds

`GET /agent/feeds/due?limit=<AGENT_DUE_FETCH_LIMIT>`, authenticated Agent icin server-owned `next_check_at` cursor'una gore due feed listesini read-only dondurur.

Response exact object shape:

```json
{
  "feeds": [
    {
      "feed_id": "35",
      "url": "https://www.ntv.com.tr/gundem.rss",
      "etag": "\"abc123\"",
      "last_modified": "Tue, 17 Jun 2026 01:00:00 GMT"
    }
  ],
  "feed_poll_interval_seconds": 900,
  "has_more_due": false
}
```

`limit` zorunlu strict ASCII decimal stringtir ve `1..500` araliginda olmalidir. Unknown, repeated, leading-zero, signed, whitespace veya non-integer query degerleri authenticated istekte `422` dondurur. Missing/wrong Agent key query validation'dan once `401` dondurur.

Eligibility exact:

```text
active = true
subscriber_count > 0
next_check_at <= captured server now
```

Query `next_check_at ASC, id ASC` sirasiyla `limit + 1` aday okur, en fazla requested `limit` feed dondurur ve ekstra aday varsa `has_more_due=true` yapar. `site_feeds` join/EXISTS, count query, cursor/offset, claim/lease/lock, Redis queue veya scheduler mutation yoktur. Downstream ACK endpoint'leri bu surumde olmadigi icin ayni due feed tekrar sorguda yeniden gorulebilir.

## Agent New GUID Filtering

`POST /agent/feeds/{feed_id}/new-guids`, authenticated Agent icin RSS 200 normalizer output'u olan GUID listesini target feed'deki existing `entries(feed_id, guid)` set'ine gore read-only filtreler.

Request exact body:

```json
{
  "guids": ["guid-a", "guid-b"]
}
```

Success response:

```json
{
  "new": ["guid-b"]
}
```

`feed_id` strict positive PostgreSQL bigint decimal stringtir. Body yalniz `guids` alanini kabul eder; query parametresi yoktur. `guids` length `1..100`, her GUID string ve code-point length `1..2048` olmalidir. Leading/trailing whitespace reddedilir. Sunucu GUID uretmez, trim etmez, normalize etmez veya URL canonicalize etmez.

Unknown feed all-new sayilmaz ve authenticated request icin `422` dondurur. Duplicate input first occurrence order ile tekillestirilir. Response request first-occurrence order'ini korur ve yalniz target feed'de absent olan GUID'leri icerir. `new: []` normal `200` success sonucudur.

Reader feed varligini ve existing target-feed GUID set'ini iki bounded Prisma read ile okur. Per-GUID query, count query, insert/update/delete/upsert, reservation, claim, lease, lock, Redis/BullMQ veya scheduler mutation yoktur. `POST /agent/entries` hattindaki `(feed_id, guid)` unique constraint ve `ON CONFLICT DO NOTHING` final write idempotency otoritesidir.

## Agent Entry Ingestion

`POST /agent/entries`, authenticated Agent icin yeni entry payload'larini kabul eder ve event ledger, yeni `entries`, basarili detail icin `entry_details` ve feed success state'ini tek PostgreSQL transaction icinde yazar.

Success response:

```json
{
  "saved": 1,
  "idempotent_replay": false
}
```

`check_id` uppercase ULID, `feed_id` decimal string bigint, `checked_at` timezone-aware ISO instant ve `entries` array length `1..100` olmalidir. Entry body unknown alan kabul etmez; `guid`, `url`, required `title`, optional content alanlari, `detail` ve required `detail_extraction` strict dogrulanir.

`checked_at` server saatinden en fazla `60` saniye ileride ve en fazla `900` saniye eski olabilir. Bu kontrol idempotent replay lookup'undan once yapilir.

Idempotency `agent_feed_check_events.check_id` uzerindedir. Ayni `check_id` ayni feed ve `entries_found` outcome ile tekrar gelirse yeni write yapilmaz, kayitli saved count ile `idempotent_replay: true` doner. Ayni `check_id` farkli feed/outcome ile gelirse `422 CHECK_ID_PAYLOAD_MISMATCH` doner.

Duplicate entry'ler hata degildir; `(feed_id, guid)` unique constraint'i ile skip edilir ve `saved` icinde sayilmaz. Feed state yalniz mevcut `last_checked_at` null veya request `checked_at` degerinden eski/esit ise guncellenir; boylece eski request feed state'i geriye alamaz.

## Agent Feed Check Results

`POST /agent/feed-check-results`, authenticated Agent icin `not_modified`, `no_new_entries` ve `fetch_error` outcome batch'ini kabul eder.

Success response exact object shape:

```json
{
  "accepted": 3,
  "feed_state_updated": 2,
  "idempotent_replay_count": 1,
  "out_of_order_result_count": 0
}
```

`results` array length `1..250` olmalidir. Her result `check_id`, `feed_id`, `checked_at`, `outcome`, `http_status`, `tier_attempted` ve outcome'a gore `error_code`/validator alanlarini strict dogrular. Unknown root/result field, empty batch, invalid outcome/status matrix, invalid feed title, stale/future `checked_at`, unknown feed veya incompatible `check_id` authenticated request'te `422` dondurur.

Idempotency `agent_feed_check_events.check_id` uzerindedir. Compatible replay `idempotent_replay_count` sayacina yazilir; incompatible replay tum batch'i rollback ile `CHECK_ID_PAYLOAD_MISMATCH` yapar. New stale result event ledger'a yazilir ama feed state monotonic kosul nedeniyle atlanir ve `out_of_order_result_count` artar.

Feed state transaction icinde guncellenir: success outcome'lari `error_count=0` ve phase-slot `next_check_at` yazar; `fetch_error` `error_count` degerini artirir ve exponential retry backoff uygular. Entry insert, detail insert, RSS fetch, GUID filtering, queue veya cleanup side effect'i yoktur.

## Migration

```powershell
docker compose run --rm migrate
```

MS-002 iki migration icerir:

- `20260620000000_initial_empty`: bilincli olarak bos baslangic migration'i.
- `20260620001000_canonical_business_schema`: canonical business PostgreSQL semasini olusturan tek MS-002 migration'i.

Ek migration komutlari:

```powershell
docker compose run --rm main-service-api npm run migrate:status
docker compose run --rm main-service-api npm run prisma:validate
docker compose run --rm main-service-api npm run prisma:format
docker compose run --rm main-service-api npm run prisma:generate
```

## Health Dogrulama

```powershell
Invoke-WebRequest http://localhost:3000/health/live
Invoke-WebRequest http://localhost:3000/health/ready
```

`/health/live` yalnizca API process'inin HTTP istegine cevap verdigini gosterir ve dis bagimlilik kontrolu yapmaz. `/health/ready` PostgreSQL, Redis ve tenant auth JWKS cache hazir oldugunda `200`, aksi halde secret veya low-level hata detayi sizdirmadan `503` doner.

## Kalite Komutlari

Bu komutlar container toolchain'i ile calistirilir:

```powershell
docker compose run --rm main-service-api npm run release:verify
docker compose run --rm main-service-api npm run test:mvp-acceptance
docker compose run --rm main-service-api npm run lint
docker compose run --rm main-service-api npm run typecheck
docker compose run --rm main-service-api npm run test:auth
docker compose run --rm main-service-api npm run test:agent-auth
docker compose run --rm main-service-api npm run test:agent-due-feeds
docker compose run --rm main-service-api npm run test:agent-heartbeat
docker compose run --rm main-service-api npm run test:agent-entries
docker compose run --rm main-service-api npm run test:agent-feed-check-results
docker compose run --rm main-service-api npm run test:agent-new-guids
docker compose run --rm main-service-worker npm run worker:health
docker compose run --rm main-service-worker npm run test:job-runner
docker compose run --rm main-service-worker npm run test:cleanup
docker compose run --rm main-service-worker npm run test:queue
docker compose run --rm main-service-worker npm run test:db:cleanup
docker compose run --rm main-service-api npm run test:db:agent-heartbeat
docker compose run --rm main-service-api npm run test:db:agent-entries
docker compose run --rm main-service-api npm run test:db:agent-feed-check-results
docker compose run --rm main-service-api npm run test:rate-limit
docker compose run --rm main-service-api npm run test:tenant-entries
docker compose run --rm main-service-api npm run test:tenant-entry-detail
docker compose run --rm main-service-api npm run test:tenant-feeds
docker compose run --rm main-service-api npm test
docker compose run --rm main-service-api npm run test:db
docker compose run --rm main-service-api npm run test:all
docker compose run --rm main-service-api npm run build
```

`npm run test:agent-auth`, Agent key config, header parser, digest verification, principal, guard ve worker boundary kontrollerini calistirir. `npm run test:agent-due-feeds`, due-feed validation, mapper, use-case, HTTP route/auth precedence, worker boundary ve Compose PostgreSQL eligibility/order/limit/no-mutation senaryolarini calistirir. `npm run test:agent-heartbeat`, heartbeat validation, use-case, HTTP route/auth/validation precedence, route inventory ve worker boundary senaryolarini calistirir. `npm run test:agent-new-guids`, new-GUID validation, mapper, use-case, HTTP route/auth precedence, worker boundary ve Compose PostgreSQL filter/no-mutation/query-count/query-plan senaryolarini calistirir. `npm run test:agent-entries`, entry ingestion validation, phase policy, use-case, HTTP route/auth precedence ve Compose PostgreSQL transaction/replay/feed-state senaryolarini calistirir. `npm run test:agent-feed-check-results`, feed-check-results validation, phase/backoff policy, use-case, HTTP route/auth precedence, worker boundary ve Compose PostgreSQL transaction/replay/out-of-order/feed-state senaryolarini calistirir. `npm run test:job-runner`, cleanup orchestrator ve API/worker module boundary senaryolarini calistirir. `npm run test:cleanup`, cleanup registry ve payload policy'sini calistirir. `npm run test:queue`, Compose Redis uzerinde BullMQ scheduler/global-concurrency/job-processing senaryolarini calistirir. `npm run test:db:cleanup`, Compose PostgreSQL uzerinde retention age/cap, detail flag, event cleanup ve vacuum senaryolarini calistirir. `npm run test:db:agent-heartbeat`, Compose PostgreSQL uzerinde heartbeat current-state/no-side-effect senaryolarini calistirir. `npm run test:db:agent-entries`, Compose PostgreSQL uzerinde entry ingestion event/entry/detail/feed-state/replay/rollback senaryolarini calistirir. `npm run test:db:agent-feed-check-results`, Compose PostgreSQL uzerinde feed-check-results event/feed-state/replay/out-of-order/rollback senaryolarini calistirir. `npm run test:rate-limit`, tenant rate-limit config, HMAC key turetimi, Redis reply parsing, guard/servis davranisi, worker siniri ve Compose icinde Redis entegrasyon senaryolarini calistirir. `npm run test:tenant-entries`, entry listeleme query validation, DTO mapping, controller/rate-limit davranisi ve Compose icinde PostgreSQL/Redis entegrasyon senaryolarini calistirir. `npm run test:tenant-entry-detail`, entry detail id/query validation, DTO mapping, controller/rate-limit davranisi, worker siniri ve Compose icinde PostgreSQL/Redis detail/null/404/invariant senaryolarini calistirir. `npm run test:tenant-feeds`, feed abonelik request dogrulama, use-case ve controller testlerini calistirir. `npm run test:db`, Compose PostgreSQL servisi uzerinde izole gecici bir database olusturur, migration'lari bastan uygular, ikinci deploy'un no-op oldugunu dogrular, katalog/constraint/index kontrollerini ve MS-004/MS-006/MS-007/MS-009/MS-010/MS-011/MS-012/MS-013/MS-014 PostgreSQL ve Redis entegrasyon senaryolarini calistirir.

`npm run release:verify`, static release integrity, lint, typecheck, unit/component tests, Prisma validate/generate, production audit ve build kapilarini fail-fast calistirir. `npm run test:mvp-acceptance`, real PostgreSQL ve Redis gerektiren integrated acceptance zinciridir ve authoritative kullanim Compose container icindedir.

## Clean-room Acceptance

Release adayini user stack veya volume'lerine dokunmadan dogrulamak icin detached worktree ve unique Compose project name kullan:

```powershell
git worktree add --detach <TEMP_PATH> HEAD
Copy-Item <TEMP_PATH>\.env.example <TEMP_PATH>\.env
docker compose -p main-service-ms015-acceptance-<unique> --project-directory <TEMP_PATH> build --no-cache
docker compose -p main-service-ms015-acceptance-<unique> --project-directory <TEMP_PATH> up -d
docker compose -p main-service-ms015-acceptance-<unique> --project-directory <TEMP_PATH> run --rm main-service-api npm run test:mvp-acceptance
docker compose -p main-service-ms015-acceptance-<unique> --project-directory <TEMP_PATH> down -v --remove-orphans
git worktree remove <TEMP_PATH>
git worktree prune
```

`down -v` yalniz unique acceptance project icin kullanilir. `.env`, SBOM, audit output, logs, DB dump veya Redis dump commit edilmez.

Supply-chain yardimci komutlari:

```powershell
npm audit --omit=dev
npm audit
npm audit signatures
npm sbom --sbom-format=cyclonedx
npm outdated
```

`MVP Adayi`, main-service repository kabul sonucudur; production deployment veya diger uygulamalarin readiness iddiasi degildir.

## Smoke Test

MS-014 icin calistirilan smoke adimlari:

```powershell
docker compose config
docker compose build
docker compose up -d
docker compose ps
Invoke-WebRequest http://localhost:3000/health/live
Invoke-WebRequest http://localhost:3000/health/ready
Invoke-WebRequest http://localhost:3000/agent/feeds/due?limit=1
Invoke-WebRequest http://localhost:3000/agent/feeds/1/new-guids
Invoke-WebRequest http://localhost:3000/agent/entries
Invoke-WebRequest http://localhost:3000/agent/feed-check-results
docker compose port main-service-worker 3000
docker compose logs main-service-worker
docker compose run --rm main-service-worker npm run worker:health
docker compose run --rm main-service-worker npm run test:job-runner
docker compose run --rm main-service-worker npm run test:cleanup
docker compose run --rm main-service-worker npm run test:queue
docker compose run --rm main-service-worker npm run test:db:cleanup
docker compose run --rm main-service-api npm run test:agent-auth
docker compose run --rm main-service-api npm run test:agent-due-feeds
docker compose run --rm main-service-api npm run test:agent-heartbeat
docker compose run --rm main-service-api npm run test:agent-entries
docker compose run --rm main-service-api npm run test:agent-feed-check-results
docker compose run --rm main-service-api npm run test:agent-new-guids
docker compose run --rm main-service-api npm run test:db:agent-heartbeat
docker compose run --rm main-service-api npm run test:db:agent-entries
docker compose run --rm main-service-api npm run test:db:agent-feed-check-results
docker compose run --rm main-service-api npm run test:rate-limit
docker compose run --rm main-service-api npm run test:tenant-entries
docker compose run --rm main-service-api npm run test:tenant-entry-detail
docker compose down
```

Worker servisinde public HTTP portu yayimlanmaz. `docker compose port main-service-worker 3000` port bulunmadigini gostermelidir. Missing Agent key ile `/agent/feeds/due?limit=1`, `/agent/feeds/1/new-guids`, `/agent/entries` ve `/agent/feed-check-results` `401` donmelidir. Worker log'larinda JWKS refresh, tenant auth lifecycle, Agent auth lifecycle, Agent heartbeat module, Agent due-feeds module, Agent new-GUID module, Agent entries module, Agent feed-check-results module, tenant rate-limit capability check, tenant entry list module veya tenant entry detail module baslangici beklenmez. Worker log'larinda maintenance queue runner bootstrap ve scheduler reconciliation kayitlari beklenir.

## Worker Scheduler Durumu

MS-014 itibariyla worker, BullMQ `main-service.maintenance` queue'sunu, `cleanup.daily` scheduler'ini ve `cleanup.run.v1` consumer'ini uygular. Worker readiness `npm run worker:health` ile PostgreSQL, Redis, scheduler inventory ve global concurrency uyumunu dogrular.

## MS-016 Production Package Verification

Production package commands generated temp paths with non-production placeholder secrets use eder; real production secrets kullanilmaz ve output commit edilmez.

```powershell
npm run test:release-packaging
npm run production:config:check -- --env-file <shared-env> --runtime-image-env <release-dir>/deploy/runtime-image.env
npm run production:compose:verify -- --env-file <shared-env> --runtime-image-env <release-dir>/deploy/runtime-image.env
npm run release:package -- --platform linux/amd64 --output <temp-release-dir>
npm run release:package:verify -- --package <temp-release-dir>
npm run production:backup -- --compose-file <compose-file> --env-file <shared-env> --runtime-image-env <release-dir>/runtime-image.env --output <temp-backup>
npm run production:restore:verify -- --backup <temp-backup>
```

`deploy/production/compose.yaml` production topology proof'tur; local JWKS fixture icermez, DB/Redis/worker host port yayinlamaz ve `MAIN_SERVICE_IMAGE` degerini shared env yerine package/runtime image env katmanindan ister. Local synthetic smoke gerekiyorsa unique Compose project, temp shared env, package `runtime-image.env` ve temp output kullanilir. Destructive cleanup only that unique project, disposable restore container and temp files ile sinirlidir.

External registry push, DNS/TLS change, CyberPanel live config, Git tag and GitHub Release MS-016 local verification commands tarafindan yapilmaz.

## MS-017 Staging Preparation Tooling

MS-017 A asamasi remote staging mutation yapmadan target safety, SSH option, remote layout, receipt ve rollback compatibility guard'larini ekler.

```powershell
npm run test:staging
npm run staging:inputs:scaffold -- --output-dir <external-empty-directory> --target-alias <staging-alias> --ssh-host <operator-host> --ssh-port 22 --ssh-user <operator-user> --known-hosts-file <external-known-hosts-path> --marker-path /etc/habersoft/environment --remote-base-dir <staging-base-dir> --project-name <staging-project> --api-port 13000 --edge-mode loopback-only
npm run staging:inputs:verify -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --mode operator-input
npm run staging:inputs:verify -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --mode operator-input --idp-contract <external-staging-idp-contract.md>
npm run staging:known-hosts:inspect -- --target <external-path>/staging-target.json
npm run staging:handoff:generate -- --output-dir <external-empty-directory> --platform linux/amd64 --edge-mode loopback-only --marker-path <operator-marker-path> --remote-base-dir <operator-staging-base-dir> --project-name <staging-project> --api-port <staging-api-port>
npm run staging:handoff:verify -- --bundle <external-output-directory>
npm run staging:rehearsal:local -- --previous-commit <previous-commit> --candidate-commit <candidate-commit> --platform linux/amd64 --output-root <external-temp-dir>
npm run staging:rehearsal:verify -- --receipt <external-temp-dir>/receipt/local-staging-rehearsal-receipt.json
npm run test:staging:handoff
npm run test:staging:rehearsal
npm run staging:preflight -- --target <external-path>/staging-target.json
npm run staging:receipt:verify -- --receipt <receipt.json>
```

`deploy/staging/target.example.json` yalniz schema ornegidir. `staging:inputs:scaffold`, production env template'inin current variable inventory'sinden external `staging.env` olusturur; target default `approved=false` gelir. `--generate-staging-secrets` kullanilirse secret degerleri yalniz external env dosyasina yazilir ve console'a basilmadan kalir. Known_hosts tool tarafindan uretilmez; operator fingerprint'i host owner ile out-of-band dogrulayip pinned dosyayi kendisi hazirlar. Local readiness receipt remote preflight receipt degildir ve host trust veya marker verification iddiasi tasimaz.

Gercek target, known_hosts, staging env, release package, runtime image env, backup ve receipt Git'e alinmaz. External `staging.env` shared config/secret dosyasidir ve `MAIN_SERVICE_IMAGE` tasimaz; image binding verified package `deploy/runtime-image.env` dosyasindan gelir. Onayli staging target ve remote marker yoksa `staging:deploy`, `staging:rollback` ve `staging:roll-forward` basari iddiasi uretmez.

External `staging.env` exact canonical production JWKS `https://auth.habersoft.com/.well-known/jwks.json` degerini secerse, validator contract-pinned IdP authorization ister. `deploy/staging/idp-contract-policy.json` yalniz public projection/hash pin tasir; full external contract repository'ye kopyalanmaz. Bu istisna yalniz `TENANT_AUTH_JWKS_URL` icindir ve diger production identifier'lari staging config icinde reddedilmeye devam eder.

`staging:rehearsal:local`, remote staging yerine gecmez. Unique local Docker project altinda previous/candidate image package'lerini, backup/restore'i ve immutable image rollback/roll-forward dry-run'ini dener. Generated package/env/backup/receipt output'u repository disinda tutulur.

`staging:handoff:generate`, operator'a host prerequisite ve external input contract bundle'i uretir. Output repository disindadir, generated target template `approved=false` kalir, secret/known_hosts/package/image uretmez ve remote host'a baglanmaz. `staging:handoff:verify`, manifest, checksum, schema identity, secret scan, path safety ve false remote/deploy flags kapilarini dogrular. Ayrintili sorumluluk icin bkz. [staging-host-provisioning.md](staging-host-provisioning.md).
