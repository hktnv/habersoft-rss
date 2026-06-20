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
- `main-service-api`: NestJS HTTP API process'i. Health endpoint'lerini, tenant auth/JWKS lifecycle'ini, tenant feed abonelik endpoint'lerini, tenant entry listeleme/detail endpoint'lerini, API-only tenant rate limiting guard'ini, Agent `X-Agent-Key` auth provider'larini, `POST /agent/heartbeat` ve `GET /agent/feeds/due` route'larini baslatir.
- `main-service-worker`: HTTP listener acmayan Nest application context. Config, PostgreSQL ve Redis baglantilarini bootstrap eder; tenant auth/JWKS lifecycle'i, Agent auth provider'lari, BullMQ consumer, cleanup scheduler veya business job calistirmaz.

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

MS-010 itibariyla `X-Agent-Key` ile korunan production Agent route'lari `POST /agent/heartbeat` ve `GET /agent/feeds/due` route'laridir. Agent key Tenant API rotalarini acmaz.

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
docker compose run --rm main-service-api npm run lint
docker compose run --rm main-service-api npm run typecheck
docker compose run --rm main-service-api npm run test:auth
docker compose run --rm main-service-api npm run test:agent-auth
docker compose run --rm main-service-api npm run test:agent-due-feeds
docker compose run --rm main-service-api npm run test:agent-heartbeat
docker compose run --rm main-service-api npm run test:db:agent-heartbeat
docker compose run --rm main-service-api npm run test:rate-limit
docker compose run --rm main-service-api npm run test:tenant-entries
docker compose run --rm main-service-api npm run test:tenant-entry-detail
docker compose run --rm main-service-api npm run test:tenant-feeds
docker compose run --rm main-service-api npm test
docker compose run --rm main-service-api npm run test:db
docker compose run --rm main-service-api npm run test:all
docker compose run --rm main-service-api npm run build
```

`npm run test:agent-auth`, Agent key config, header parser, digest verification, principal, guard ve worker boundary kontrollerini calistirir. `npm run test:agent-due-feeds`, due-feed validation, mapper, use-case, HTTP route/auth precedence, worker boundary ve Compose PostgreSQL eligibility/order/limit/no-mutation senaryolarini calistirir. `npm run test:agent-heartbeat`, heartbeat validation, use-case, HTTP route/auth/validation precedence, route inventory ve worker boundary senaryolarini calistirir. `npm run test:db:agent-heartbeat`, Compose PostgreSQL uzerinde heartbeat current-state/no-side-effect senaryolarini calistirir. `npm run test:rate-limit`, tenant rate-limit config, HMAC key turetimi, Redis reply parsing, guard/servis davranisi, worker siniri ve Compose icinde Redis entegrasyon senaryolarini calistirir. `npm run test:tenant-entries`, entry listeleme query validation, DTO mapping, controller/rate-limit davranisi ve Compose icinde PostgreSQL/Redis entegrasyon senaryolarini calistirir. `npm run test:tenant-entry-detail`, entry detail id/query validation, DTO mapping, controller/rate-limit davranisi, worker siniri ve Compose icinde PostgreSQL/Redis detail/null/404/invariant senaryolarini calistirir. `npm run test:tenant-feeds`, feed abonelik request dogrulama, use-case ve controller testlerini calistirir. `npm run test:db`, Compose PostgreSQL servisi uzerinde izole gecici bir database olusturur, migration'lari bastan uygular, ikinci deploy'un no-op oldugunu dogrular, katalog/constraint/index kontrollerini ve MS-004/MS-006/MS-007/MS-009/MS-010 PostgreSQL entegrasyon senaryolarini calistirir.

## Smoke Test

MS-010 icin calistirilan smoke adimlari:

```powershell
docker compose config
docker compose build
docker compose up -d
docker compose ps
Invoke-WebRequest http://localhost:3000/health/live
Invoke-WebRequest http://localhost:3000/health/ready
Invoke-WebRequest http://localhost:3000/agent/feeds/due?limit=1
docker compose port main-service-worker 3000
docker compose logs main-service-worker
docker compose run --rm main-service-api npm run test:agent-auth
docker compose run --rm main-service-api npm run test:agent-due-feeds
docker compose run --rm main-service-api npm run test:agent-heartbeat
docker compose run --rm main-service-api npm run test:db:agent-heartbeat
docker compose run --rm main-service-api npm run test:rate-limit
docker compose run --rm main-service-api npm run test:tenant-entries
docker compose run --rm main-service-api npm run test:tenant-entry-detail
docker compose down
```

Worker servisinde public HTTP portu yayimlanmaz. `docker compose port main-service-worker 3000` port bulunmadigini gostermelidir. Missing Agent key ile `/agent/feeds/due?limit=1` `401` donmelidir. Worker log'larinda JWKS refresh, tenant auth lifecycle, Agent auth lifecycle, Agent heartbeat module, Agent due-feeds module, tenant rate-limit capability check, tenant entry list module veya tenant entry detail module baslangici beklenmez.

## Worker Scheduler Durumu

Bu milestone worker scheduler implementasyonu degildir. Worker process'i yalnizca standalone Nest application context olarak acilir, PostgreSQL ve Redis baglantilarini dogrular ve SIGTERM/SIGINT sirasinda kontrollu kapanir. BullMQ scheduler inventory reconciliation, cleanup job ve worker readiness ayrintilari sonraki bounded milestone'a birakilmistir.
