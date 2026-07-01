# Habersoft RSS Production Operator Guide

## 1. Belgenin amaci ve otoritesi

Bu belge, `habersoft-rss` repository'sinin production sunucusunda Git tabanli olarak nasil alinacagini, nasil build edilecegini, nasil calistirilacagini, nasil dogrulanacagini ve sorun durumunda nasil geri alinacagini aciklar.

Bu belge insan operator icindir. Codex production sunucusuna SSH baglanmaz, source upload etmez, Docker/OpenLiteSpeed/DNS/TLS komutu calistirmaz ve production deployment yaptigini iddia etmez.

Current main-service production activation status ve operator-confirmed evidence'in canonical repository-local sahibi [.docs/production-acceptance.md](.docs/production-acceptance.md) dosyasidir. Bu guide yeniden kullanilabilir operator prosedurudur; kendi basina success receipt degildir.

Current application status: `MVP — Production Aktif`.

MS-022A source contains a disabled-by-default admin auth/session foundation for the not-deployed `rss-admin-ui`. Production backend operation does not enable it by default: `ADMIN_UI_AUTH_MODE=disabled` is the safe baseline, no default admin credential exists, and production secret provisioning for `single_admin` remains separate operator-authorized work. MS-022B adds secretless admin auth hash/session-secret/config helpers and local production-mode RC validation for a future operator-authorized activation package. MS-022A/MS-022B do not deploy the admin UI, do not change production CORS or edge routing, do not publish a registry image, do not create a Git tag or GitHub Release, and do not bump the active backend package version. The admin UI remains `MS-022B_PRODUCTION_ACTIVATION_PACKAGE_READY - NOT_DEPLOYED`.

Admin auth production activation details are documented in [.docs/admin-auth-production-activation.md](.docs/admin-auth-production-activation.md). The backend helper commands are:

```bash
npm run admin-auth:hash
npm run admin-auth:secret
npm run admin-auth:verify-config
npm run production:admin-auth:diagnose:redacted -- --synthetic
npm run production:admin-auth:compose:verify
```

Real production password hashes and session secrets are operator-owned secret material and must not be committed to Git.

MS-024B backend operator ergonomics keeps production Compose secret and runtime image protections intact. Backend Compose still requires the real operator `.env.production` and `deploy/runtime-image.env`; those values must not be defaulted in Git. For inspection, use helpers that auto-locate the standard env files without printing them:

```bash
npm run ops:compose:ps
npm run ops:compose:logs -- main-service-api
npm run ops:compose:config
npm run production:diagnose:redacted
```

If those files are absent, `npm run production:diagnose:redacted` reports the missing operator-owned files without reading or printing secret values. This is part of the MS-024B graduated guardrails policy: reduce harmless inspection friction without weakening backend secrets.

MS-024E admin-auth configured boundary: MS-024D's backend runtime env wiring has operator-reported live evidence. Backend diagnostics passed with `ADMIN_AUTH_SINGLE_ADMIN_CONFIG_PRESENT`, the API service received admin-auth env, the worker remained `worker_absent_by_design`, and backend loopback `/admin-auth/session` returned `configured=true`, `authenticated=false`, `reason=unauthenticated`. Production Compose maps the admin-auth variables from the operator env files into `main-service-api`; it intentionally does not map them into `main-service-worker`. Validate the operator-owned backend env file with:

```bash
npm run admin-auth:verify-config -- --env-file <operator-backend-auth-env> --require-enabled
npm run production:admin-auth:diagnose:redacted -- --synthetic
npm run production:admin-auth:compose:verify
```

The redacted diagnostics now distinguish `required_missing`, `optional_defaulted`, `configured_present`, `worker_absent_by_design`, `frontend_proxy_recreate_required`, `auth_configured_unauthenticated`, and `authenticated_login_not_yet_proven`. `ADMIN_UI_SESSION_TTL_SECONDS`, `ADMIN_UI_SESSION_COOKIE_NAME`, and `ADMIN_UI_SESSION_REDIS_PREFIX` are optional/defaulted when absent; they are not required gaps when the strict `single_admin` values are valid. For an admin-auth-only env activation, the affected backend service is `main-service-api`; `main-service-worker` does not consume admin auth and need not be recreated solely for this change. Standard backend image/shared-env rollouts can still recreate API and worker together under the operator rollback/config decision. Use `npm run ops:production:recreate:api-worker -- --dry-run` for redacted backend API/worker recreate guidance and `npm run ops:production:recreate:api-worker -- --apply` only for an operator-owned mutation. After any backend API/image/network/admin-auth env recreate, also run `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate -- --apply` so frontend proxy upstream/network references are refreshed before auth smoke.

MS-024F authenticated admin shell boundary: the operator reports that, after MS-024E delivery, production retest accepted the authenticated admin shell for the current implemented status/auth shell scope. This is an `operator_reported` acceptance statement; Codex did not independently perform a credentialed login, did not read, hash, print, copy, or persist real admin credentials/cookies/session material, and did not mutate production. Future business/admin write features are not accepted. `auth-smoke:redacted` remains a redacted regression/sanity tool, not a pending acceptance blocker for the current implemented shell scope unless new contradictory evidence appears.

MS-025A protected admin operations boundary: repository source now contains `GET /admin-api/operations/summary`, an authenticated read-only aggregate summary route for the admin UI. It requires the existing admin-auth session, returns no operations metrics for disabled or unauthenticated auth states, rejects non-GET with `405`, and exposes only aggregate dependency/feed/entry/ingestion counts plus safe notes. It does not add writes, migrations, Tenant/Agent browser credentials, production CORS broadening, or production activation by Codex. MS-025A-R2 records operator-reported production acceptance for this read-only route through the admin UI and proxy. After backend API/image/network/admin-auth env recreate, also run `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate` before frontend edge regression checks.

Admin operations summary API details are documented in [.docs/admin-operations-summary-api.md](.docs/admin-operations-summary-api.md). The backend package version remains `0.1.0-ms-017`; the route is protected, read-only, locally RC-validated, and accepted in production only by operator-reported MS-025A-R2 browser/proxy evidence, not as a standalone backend production release.

MS-025B protected admin operations drilldown boundary: repository source now contains `GET /admin-api/operations/drilldown`, an authenticated read-only bounded drilldown route for the existing admin UI. Status is `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`. It requires the existing admin-auth session, returns no drilldown rows for disabled or unauthenticated auth states, rejects non-GET with `405`, and exposes only bounded feed and ingestion signals using `recentHours=24`, `maxRows=20`, opaque `displayId` hashes, public `sourceHost` only, safe counts, safe statuses, and safe notes. It does not expose raw feed URL paths or queries, entry content, raw logs, raw request/response bodies, private hostnames, tenant identifiers, cookies, password hashes, session secrets, database/Redis URLs, Agent key values, Tenant bearer tokens, JWT claims, or stack traces. It does not add writes, migrations, dependencies, package version changes, Tenant/Agent browser credentials, production CORS broadening, registry publication, Git tag/release, PR, or production activation by Codex.

MS-025A-R2 production acceptance remains accepted for the existing operations summary dashboard. MS-025B-R1 closes read-only drilldown production acceptance by operator-reported live retest evidence; No production deployment was performed by Codex for MS-025B-R1. Drilldown API details are documented in [.docs/admin-operations-drilldown-api.md](.docs/admin-operations-drilldown-api.md). After future backend API image/runtime changes, the operator should rebuild/update the backend as required by current runbooks, then rebuild/update the frontend image if `nginx.conf` or `docker-entrypoint.sh` changed, and run `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate` before regression testing `GET /admin-api/operations/drilldown` through the panel.

MS-026A bounded admin feed recheck boundary: repository source now contains `POST /admin-api/operations/feed-recheck-requests`, an authenticated bounded feed recheck request action for the existing admin UI. Status is `MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`. The route requires the existing admin-auth session, JSON body, `X-Admin-CSRF`, `X-Admin-Idempotency-Key`, opaque `actionRef`, and a 300 second cooldown. It validates an eligible active feed with subscribers and public `sourceHost`, then requests the existing due-feed path by moving only that feed's `nextCheckAt` to now. It performs no synchronous external feed fetch, no entry mutation, no feed CRUD, no tenant management, no raw feed URL path/query exposure, no Agent key use, no Tenant bearer token use, no migration, no dependency change, and no backend package version bump. No production deployment was performed by Codex for MS-026A. Operator deploy/retest required remains; do not paste credentials, cookies, sessions, CSRF tokens, idempotency keys, raw response bodies with sensitive values, raw feed URLs, raw logs, or secrets.

MS-026B operator automation boundary: `MS-026B_OPERATOR_REPORTED_FEED_RECHECK_ROUTE_DEPLOYED_NO_ELIGIBLE_TARGET` records operator-reported production route smoke after the MS-026A rebuild/recreate. Backend/frontend/worker health passed, admin exact routes and JSON 404/405/401 behavior passed, browser login succeeded, and Operations Overview/Drilldown loaded. Production reported zero feeds and no eligible actionRef, so feed recheck effect remains `NO_ELIGIBLE_FEED_RECHECK_TARGET`, `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`, and `PENDING_NO_ELIGIBLE_TARGET`; do not create, seed, or fake production feed data. Operators can run `cd ../rss-admin-ui && npm run ops:production:retest:redacted`, `npm run ops:production:acceptance:redacted -- --endpoint https://rss-panel.habersoft.com`, and `npm run ops:feed-recheck:eligibility:redacted -- --endpoint https://rss-panel.habersoft.com` for redacted evidence. Risk tiers are CRITICAL fail-closed, HIGH apply-blocking, MEDIUM warn/degrade, and LOW informational; critical auth/session/secret/write-route/admin-api-HTML-fallback boundaries remain unchanged.

MS-026C one-command automation boundary: `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED` composes backend API/worker recreate, frontend recreate, route proof, redacted acceptance, and browser evidence verification into `cd ../rss-admin-ui && npm run ops:production:retest`. Default is dry-run; `--apply` is operator-owned mutation; Codex does not execute production Docker, read production env files, or use real credentials. If credentials are absent, the frontend script reports `AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED`. Browser evidence verification can report `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`, or future `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED`; feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` until that future eligible-target receipt exists.

MS-026C-R1 operator automation acceptance boundary: `SUCCESS_MS_026C_R1_OPERATOR_AUTOMATION_PRODUCTION_ACCEPTANCE_CLOSED_FEED_RECHECK_PENDING_NO_TARGET` records operator-reported production acceptance for the one-command automation/browser-evidence package only. Accepted redacted statuses are `OPERATOR_PROMOTION_RETEST_REDACTED_OK`, `NGINX_ROUTE_PROOF_ACCEPTED`, `browser-evidence-verify-ok`, `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, and `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`; critical risk `none`; no production contact by Codex. Feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`. No production feed was created, seeded, or faked. No fake actionRef was generated. Feed recheck effect acceptance remains future work requiring a real eligible production feed and redacted browser evidence.

Production source delivery icin tek gecerli akış:

```text
local commit
-> local tests
-> git push origin main
-> server git pull --ff-only origin main
-> server-local Docker build
-> server Docker Compose migrate/up
```

Kaynak kodu sunucuya scp, rsync, SFTP, ZIP, panel upload veya kopyala-yapistir ile tasinmaz.

## 2. Mimariye genel bakis

```text
Internet
   |
   v
OpenLiteSpeed / CyberPanel edge
   |
   +-- auth.habersoft.com       -> 127.0.0.1:3100
   +-- auth-panel.habersoft.com -> 127.0.0.1:8080
   +-- rss.habersoft.com        -> 127.0.0.1:3200
   `-- rss-panel.habersoft.com  -> 127.0.0.1:8081 (planned/inactive)
```

```text
rss.habersoft.com
    |
    v
main-service-api
    |
    +-- PostgreSQL
    `-- Redis

main-service-worker
    |
    +-- PostgreSQL
    `-- Redis/BullMQ

migrate
    `-- PostgreSQL
```

OpenLiteSpeed edge katmanidir. Uygulamalar Docker container'larindan servis edilir. OpenLiteSpeed docRoot dizinleri bos kalir; gercek trafik reverse proxy ile loopback upstream'lere gider.

## 3. Ayni sunucudaki Habersoft servisleri ve port matrisi

| Servis | Domain | Loopback upstream | Durum |
|---|---|---:|---|
| Auth API | `auth.habersoft.com` | `127.0.0.1:3100` | mevcut |
| Auth panel | `auth-panel.habersoft.com` | `127.0.0.1:8080` | mevcut |
| RSS backend API | `rss.habersoft.com` | `127.0.0.1:3200` | backend active |
| RSS panel | `rss-panel.habersoft.com` | `127.0.0.1:8081` | planned/inactive |

`3200` ve `8081`, mevcut auth portlariyla carpismaz diye secilen RSS varsayilanlaridir. Operator port durumunu kontrol eder:

```bash
ss -ltnp | grep -E ':(3100|3200|8080|8081)\b' || true
```

Eger `3200` doluysa `API_HOST_PORT` ve OpenLiteSpeed upstream birlikte degistirilir. Eger `8081` doluysa bu yalniz future panel planini etkiler; bu milestone'da panel aktif degildir.

## 4. Repository ve sunucu dizin yapisi

Production repository dizini:

```text
/opt/habersoft-rss
```

MS-020A repository topology:

```text
/opt/habersoft-rss/
|-- PRODUCTION.md
|-- rss-habersoft-com/
`-- rss-admin-ui/
```

`rss-habersoft-com` bu guide'in backend project root'udur. Root `PRODUCTION.md` umbrella guide'dir; `rss-admin-ui/PRODUCTION.md` frontend foundation delivery contract'ini sahiplenir.

Current production status:

```text
PRODUCTION_PATH_MIGRATION_NOT_PERFORMED_IN_MS-020A
```

MS-020A repository path migration'i production host'ta `git pull`, deploy, restart veya image rebuild olarak uygulanmaz. Mevcut runtime onceki deployed image ile calismaya devam eder. Future operator deployment ayrica yetkilendirilirse checkout backend subdirectory'yi kullanacak sekilde guncellenir ve production preflight/evidence gate'leri yeniden calistirilir.

Komutlar su otomatik backend dizin secimini kullanir:

```bash
REPO_DIR=/opt/habersoft-rss

if [ -f "$REPO_DIR/rss-habersoft-com/package.json" ]; then
  BACKEND_DIR="$REPO_DIR/rss-habersoft-com"
else
  BACKEND_DIR="$REPO_DIR"
fi
```

Production env dosyasi:

```text
$BACKEND_DIR/.env.production
```

Generated runtime image binding:

```text
$BACKEND_DIR/deploy/runtime-image.env
```

Ikisi de source code degildir ve Git'e commit edilmez.

## 5. Degismez Git tabanli deployment kurali

Operator production sunucusunda dirty working tree ile deployment yapmaz.

Gecerli kaynak alma komutu:

```bash
cd /opt/habersoft-rss
git fetch origin
git switch main
git pull --ff-only origin main
git status --short
```

`git status --short` bos donmelidir. Bos degilse deployment durur; operator once sunucu working tree'sinin neden degistigini bulur.

Yasaklar:

- `git pull` komutunu `--ff-only` olmadan calistirmak
- sunucuda tracked source dosyasi editlemek
- local Docker context'i sunucuya kopyalamak
- `node_modules` kopyalamak
- source archive kopyalamak
- panel upload ile tracked dosya degistirmek
- production secret'i Git'e yazmak

## 6. Ilk kurulum

Ilk kurulum operator tarafindan sunucuda yapilir:

```bash
cd /opt
git clone https://github.com/hktnv/habersoft-rss.git
cd /opt/habersoft-rss
git switch main
git pull --ff-only origin main
git status --short
```

Backend dizinini sec:

```bash
REPO_DIR=/opt/habersoft-rss

if [ -f "$REPO_DIR/backend/package.json" ]; then
  BACKEND_DIR="$REPO_DIR/backend"
else
  BACKEND_DIR="$REPO_DIR"
fi
```

Port kontrolu:

```bash
ss -ltnp | grep -E ':(3100|3200|8080|8081)\b' || true
```

Production env olustur:

```bash
cp "$BACKEND_DIR/deploy/production/production.env.template" "$BACKEND_DIR/.env.production"
chmod 600 "$BACKEND_DIR/.env.production"
```

Operator `.env.production` dosyasini sunucuda duzenler. Production icin `API_HOST_PORT=3200` kullanilir. `MAIN_SERVICE_IMAGE` bu dosyada bulunmaz.

## 7. Guncelleme turune gore deployment akisilari

### 7.1 Documentation-only change

```bash
cd /opt/habersoft-rss
git fetch origin
git switch main
git pull --ff-only origin main
git status --short
```

Container restart gerekmez.

### 7.2 Backend application, Dockerfile veya dependency change

Akis:

```text
git pull --ff-only
server-local Docker build
runtime-image.env olusturma
Compose config verify
migrate
API ve worker recreate
health verify
```

Uygulanacak komut modeli 8, 10, 11 ve 13. bolumlerde verilir.

### 7.3 `.env.production` only

Secret veya config degisikligi Git commit'i degildir. Operator sunucuda env dosyasini duzenler:

```bash
REPO_DIR=/opt/habersoft-rss

if [ -f "$REPO_DIR/backend/package.json" ]; then
  BACKEND_DIR="$REPO_DIR/backend"
else
  BACKEND_DIR="$REPO_DIR"
fi

chmod 600 "$BACKEND_DIR/.env.production"
```

Sonra Compose config dogrulanir ve etkilenen servisler recreate edilir.

### 7.4 Prisma migration change

Migration iceren release icin once backup alinir. Sonra Git pull, server-local build, migrate, API/worker recreate ve health verify sirasiyla calisir.

### 7.5 Future frontend change

Frontend henuz yoktur. `rss-panel.habersoft.com` planned/inactive durumdadir.

Frontend milestone'u gelene kadar:

```text
no frontend build command
no rss-panel vhost activation claim
```

## 8. Backend build ve immutable image kimligi

Production image sunucuda, exact Git commit'ten build edilir:

```bash
cd /opt/habersoft-rss

git fetch origin
git switch main
git pull --ff-only origin main
git status --short

DEPLOY_COMMIT="$(git rev-parse HEAD)"
SHORT_COMMIT="$(git rev-parse --short=12 HEAD)"

REPO_DIR=/opt/habersoft-rss

if [ -f "$REPO_DIR/backend/package.json" ]; then
  BACKEND_DIR="$REPO_DIR/backend"
else
  BACKEND_DIR="$REPO_DIR"
fi

IMAGE_TAG="habersoft-rss-backend:${SHORT_COMMIT}"

docker build \
  --pull \
  --label "org.opencontainers.image.revision=${DEPLOY_COMMIT}" \
  --label "org.opencontainers.image.source=https://github.com/hktnv/habersoft-rss" \
  --tag "${IMAGE_TAG}" \
  "${BACKEND_DIR}"

IMAGE_ID="$(docker image inspect "${IMAGE_TAG}" --format '{{.Id}}')"

printf 'MAIN_SERVICE_IMAGE=%s\n' "${IMAGE_ID}" > "${BACKEND_DIR}/deploy/runtime-image.env"
```

Dogrulama:

```bash
cat "${BACKEND_DIR}/deploy/runtime-image.env"

docker image inspect "${IMAGE_ID}" \
  --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

`runtime-image.env`, gercek build edilen image ID'den uretilir. Elle tahmin edilmez. Master dokumantasyon hash'i degildir. Mutable `latest` kullanimi yasaktir.

## 9. Environment dosyasi

Template:

```text
$BACKEND_DIR/deploy/production/production.env.template
```

Production dosyasi:

```text
$BACKEND_DIR/.env.production
```

Zorunlu operator ayarlari:

- `NODE_ENV=production`
- `API_HOST_PORT=3200`
- `TENANT_AUTH_JWKS_URL=https://auth.habersoft.com/.well-known/jwks.json`
- production-specific PostgreSQL identity
- production-specific Redis/BullMQ prefixes
- strong `POSTGRES_PASSWORD`
- strong `TENANT_RATE_LIMIT_KEY_SECRET`
- strong `AGENT_KEY`
- `ADMIN_UI_AUTH_MODE=disabled` unless an operator-authorized `single_admin` activation is in progress
- production `ADMIN_UI_*` admin-auth values only when `single_admin` is intentionally enabled
- `MAIN_SERVICE_IMAGE` absent

`ADMIN_UI_ADMIN_PASSWORD_HASH` uses the PBKDF2 format `pbkdf2-sha256$120000$<salt>$<digest>`. In `.env.production` consumed by Docker Compose, escape each literal `$` as `$$`; the backend verifiers accept the escaped file form, and Compose renders a single `$` inside `main-service-api`.

`.env.production` Git'e commit edilmez. Gercek secret degerleri bu belgeye, issue'ya, commit'e veya receipt'e yazilmaz.

## 10. Docker Compose servisleri ve baslangic sirasi

Once ortak degiskenleri tanimla:

```bash
REPO_DIR=/opt/habersoft-rss

if [ -f "$REPO_DIR/backend/package.json" ]; then
  BACKEND_DIR="$REPO_DIR/backend"
else
  BACKEND_DIR="$REPO_DIR"
fi

COMPOSE_FILE="${BACKEND_DIR}/deploy/production/compose.yaml"
SHARED_ENV="${BACKEND_DIR}/.env.production"
IMAGE_ENV="${BACKEND_DIR}/deploy/runtime-image.env"
```

Production Compose context zorunlu olarak bu uc path ile baglanir. Bare `docker compose ...` production command'i degildir; repo root `compose.yaml` local/default model icindir ve production shared env layer'ini yuklemez. Production icin command shape her zaman:

```bash
docker compose --env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}" <subcommand>
```

`--env-file` only supplies interpolation values to Docker Compose. A variable reaches a container only when the target service lists it under `environment:`. The production Compose file explicitly passes admin-auth variables to `main-service-api` and intentionally omits them from `main-service-worker`.

Post-backend-recreate frontend guardrail: after `main-service-api`, the backend Compose project/network, the backend runtime image, or backend admin-auth env is recreated, run the canonical frontend helper from the frontend project:

```bash
cd /opt/habersoft-rss/rss-admin-ui
npm run ops:compose:recreate
```

The helper uses the backend-network overlay when configured. Without this follow-up, the frontend Nginx container can retain stale backend upstream/network references and status/auth proxy routes may return `502` or `auth_unavailable` even while backend loopback auth is correctly configured.

Compose config dogrulama:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  config

npm run production:admin-auth:compose:verify
```

Data servislerini baslat:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  up -d postgres redis
```

Migration calistir:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  run --rm migrate
```

API ve worker'i recreate et:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  up -d --force-recreate main-service-api main-service-worker
```

Admin-auth-only env activation minimum recreate:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  up -d --force-recreate main-service-api
```

Mevcut model bes servistir: `postgres`, `redis`, `migrate`, `main-service-api`, `main-service-worker`. `migrate` finite roldur. API container portu `3000` dinler ve host tarafinda yalniz loopback'e baglanir. Worker HTTP portu yayinlamaz. PostgreSQL ve Redis host portu yayinlamaz.

Compose icinde `--build` kullanilmaz; build otoritesi explicit `docker build` ve generated immutable image env'dir.

## 11. Migration

Migration durumu kontrolu:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  run --rm migrate npm run migrate:status
```

Deployment migration:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  run --rm migrate
```

`prisma db push` production'da kullanilmaz. Migration rewrite yapilmaz. Volume silinmez.

## 12. OpenLiteSpeed reverse proxy ve bos docRoot modeli

| Domain | docRoot | Reverse-proxy target | Status |
|---|---|---:|---|
| `auth.habersoft.com` | existing auth empty docRoot | `127.0.0.1:3100` | existing |
| `auth-panel.habersoft.com` | existing auth-panel empty docRoot | `127.0.0.1:8080` | existing |
| `rss.habersoft.com` | `/home/habersoft.com/rss` | `127.0.0.1:3200` | backend active |
| `rss-panel.habersoft.com` | `/home/habersoft.com/rss-panel` | `127.0.0.1:8081` | planned/inactive |

Kurallar:

- docRoot dizinleri bos kalir.
- TLS OpenLiteSpeed/CyberPanel edge'de terminate edilir.
- HTTP HTTPS'e redirect edilir.
- Proxy `Host` ve canonical forwarding header'larini korur.
- Request body limit, 5 MiB Agent entries payload sozlesmesini kesmez.
- Container API portunun public Internet'e dogrudan acilmasi yasaktir.

## 13. Saglik kontrolu

Internal API checks:

```bash
curl -fsS http://127.0.0.1:3200/health/live
curl -fsS http://127.0.0.1:3200/health/ready
```

Public checks:

```bash
curl -fsS https://rss.habersoft.com/health/live
curl -fsS https://rss.habersoft.com/health/ready
```

Beklenen durum:

```text
live = 200
ready = 200
postgres = up
redis = up
tenantAuth = up
```

MS-018C current known activation evidence, operator tarafindan 2026-06-22 tarihinde internal loopback ve public HTTPS live/ready checks icin bu beklenen durumun passed oldugunu kaydeder. Bu evidence [.docs/production-acceptance.md](.docs/production-acceptance.md) dosyasinda kanoniktir.

Worker health:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  exec main-service-worker npm run worker:health
```

Auth boundary smoke:

```bash
curl -i https://rss.habersoft.com/not-found
curl -i https://rss.habersoft.com/api/feeds
curl -i https://rss.habersoft.com/agent/feeds/due
```

Beklenen: unknown route `404`, unauthenticated Tenant route `401`, unauthenticated Agent route `401`. Gercek Agent key veya JWT bu belgeye yazilmaz.

MS-018C inputunda worker health, auth boundary smoke, TLS fingerprint/expiry, redirect ve edge body-limit evidence kaydedilmedi. Bu alanlar failed degil, `NOT_RECORDED` durumundadir.

## 14. Log ve servis yonetimi

Servis durumu:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  ps
```

API log:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  logs -f main-service-api
```

Worker log:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  logs -f main-service-worker
```

Migrate log:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  logs --tail=100 migrate
```

API restart:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  restart main-service-api
```

Worker restart:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  restart main-service-worker
```

Tum stack'i volume silmeden durdurmak:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  down
```

`docker compose down` volume silmez. `-v` kullanilmaz.

## 15. Backup ve restore

Migration veya riskli rollout oncesi PostgreSQL backup alinir. Backup Git disinda tutulur, SHA-256 kaydedilir ve off-host kopyasi operator tarafindan yonetilir.

MS-019C handoff-v2, landed-main-pinned repository tooling kullanir. Feature branch checkout kullanilmaz; production host canonical `main` checkout'u uzerinden calisir. Handoff-v1 superseded/historical durumdadir ve yeni backup denemesinde kullanilmaz.

Once landed tooling cekilir:

```bash
cd "${BACKEND_DIR}"
git fetch origin
git switch main
git pull --ff-only origin main
git rev-parse HEAD
```

Sonra handoff-v2 checksum ve shell syntax dogrulanir:

```bash
cd "<operator-approved-ms-019c-handoff-v2-dir>"
sha256sum -c checksums.sha256
bash -n capture-production-postgres-backup.sh
bash -n verify-off-host-postgres-restore.sh
```

Safe preflight-only:

```bash
cd "${BACKEND_DIR}"

<operator-approved-ms-019c-handoff-v2-dir>/capture-production-postgres-backup.sh \
  --repository-dir "${BACKEND_DIR}" \
  --compose-file "${COMPOSE_FILE}" \
  --shared-env "${SHARED_ENV}" \
  --runtime-image-env "${IMAGE_ENV}" \
  --output-dir "<absolute-new-empty-production-backup-output-dir>" \
  --preflight-only
```

Preflight repository identity, required landed commit ancestry, required tool file SHA-256, required tool dirty-state, core CLI contract, Compose/shared-env/runtime-image-env file presence ve output collision guard'larini kontrol eder. Full production worktree clean olmak zorunda degildir; yalniz required tooling closure temiz ve hash-matched olmalidir.

Capture ayni komutun `--preflight-only` olmadan calistirilmasidir:

```bash
cd "${BACKEND_DIR}"

<operator-approved-ms-019c-handoff-v2-dir>/capture-production-postgres-backup.sh \
  --repository-dir "${BACKEND_DIR}" \
  --compose-file "${COMPOSE_FILE}" \
  --shared-env "${SHARED_ENV}" \
  --runtime-image-env "${IMAGE_ENV}" \
  --output-dir "<absolute-new-empty-production-backup-output-dir>"
```

Capture output su flat dosyalardan olusur ve Git disinda tutulur:

```text
main-service-production.dump
backup-capture-metadata.json
backup-capture-receipt.json
checksums.sha256
```

Bu set operator-approved secure channel ile off-host/local verification ortamina tasinir. ZIP sadece transfer container'i olabilir; canonical intake dizinine ZIP konmaz.

Failed onceki output directory tekrar kullanilmaz. Production capture icin `bash -x`, `set -x`, raw stderr/env paste, feature branch checkout ve direct core CLI flag guessing kullanilmaz. Preflight fail olursa yalniz `MS019C_PREFLIGHT_FAILED:<CLASS>` raporlanir.

Returned bundle local intake once safe authority record olusturur. Authority record flat inventory, capture checksum/tree digest, backup SHA ve no-secret/no-raw-data flags tasir; raw dump veya row data icermez.

```bash
cd "${BACKEND_DIR}"

node scripts/production-backup-restore-evidence.mjs authority:create \
  --capture-dir "<flat-returned-production-backup-dir>" \
  --output "<external-returned-authority-record>"
```

Restore verification off-host disposable Docker ortaminda calisir:

```bash
cd "${BACKEND_DIR}"

npm run production:restore:verify -- \
  --input-dir "<flat-returned-production-backup-dir>" \
  --authority "<external-returned-authority-record>" \
  --receipt "<external-off-host-restore-receipt>"
```

Verifier yalniz local Docker engine endpoint sinifini kabul eder; SSH/remote TCP/production context reddedilir. Unique disposable PostgreSQL container, network ve volume kullanir, host port yayinlamaz, six canonical business table ve iki Prisma migration kaydini dogrular, sonra disposable kaynaklarin silindigini kanitlar.

Combined receipt parent MS-019B operational receipt'e, handoff-v2 manifest/tooling lock'a, returned authority record'a ve off-host restore receipt'e baglanir:

```bash
cd "${BACKEND_DIR}"

npm run production:backup-restore:receipt:create -- \
  --capture-dir "<flat-returned-production-backup-dir>" \
  --restore-receipt "<external-off-host-restore-receipt>" \
  --authority "<external-returned-authority-record>" \
  --handoff "<operator-approved-ms-019c-handoff-v2-dir>" \
  --output "<external-combined-backup-restore-receipt>"

npm run production:backup-restore:receipt:verify -- \
  --receipt "<external-combined-backup-restore-receipt>" \
  --require-backup-restore-baseline
```

Host Node/npm kullanilmayacaksa operator native PostgreSQL araclariyla ayni `pg_dump -Fc` ve off-host disposable restore sozlesmesini uygular. Production restore rutin rollback degildir; sadece kanitlanmis data/schema uyumsuzlugu varsa ayrica karar verilir.

## 16. Rollback

Deployment oncesi nonsecret rollback kaydi operator-state altinda tutulur:

```bash
mkdir -p /opt/habersoft-rss/operator-state/ms-019d

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
PREVIOUS_IMAGE_ID="$(awk -F= '$1=="MAIN_SERVICE_IMAGE" {print $2}' "${BACKEND_DIR}/deploy/runtime-image.env")"

printf 'POINTER_CONTRACT_VERSION=production-release-pointer-state-v1\nPREVIOUS_COMMIT=%s\nPREVIOUS_IMAGE_ID=%s\n' \
  "${PREVIOUS_COMMIT}" \
  "${PREVIOUS_IMAGE_ID}" \
  > /opt/habersoft-rss/operator-state/ms-019d/previous-main-service-release.env

chmod 600 /opt/habersoft-rss/operator-state/ms-019d/previous-main-service-release.env
```

Pointer file shell olarak source edilmez. Bu dosya yalniz `PREVIOUS_COMMIT=<40-hex>` ve `PREVIOUS_IMAGE_ID=sha256:<64-hex>` data alanlarini tasir; unknown key, duplicate key, shell expansion veya secret-looking alan varsa rollback procedure durur.

Primary rollback:

```bash
POINTER_FILE=/opt/habersoft-rss/operator-state/ms-019d/previous-main-service-release.env

awk -F= 'NF!=2 || !($1=="POINTER_CONTRACT_VERSION" || $1=="PREVIOUS_COMMIT" || $1=="PREVIOUS_IMAGE_ID") {exit 1}' "${POINTER_FILE}"

PREVIOUS_COMMIT="$(awk -F= '$1=="PREVIOUS_COMMIT" {print $2}' "${POINTER_FILE}")"
PREVIOUS_IMAGE_ID="$(awk -F= '$1=="PREVIOUS_IMAGE_ID" {print $2}' "${POINTER_FILE}")"

printf '%s' "${PREVIOUS_COMMIT}" | grep -Eq '^[0-9a-f]{40}$' || { echo "Invalid PREVIOUS_COMMIT" >&2; exit 1; }
printf '%s' "${PREVIOUS_IMAGE_ID}" | grep -Eq '^sha256:[0-9a-f]{64}$' || { echo "Invalid PREVIOUS_IMAGE_ID" >&2; exit 1; }

docker image inspect "${PREVIOUS_IMAGE_ID}" \
  --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.source"}}'

printf 'MAIN_SERVICE_IMAGE=%s\n' "${PREVIOUS_IMAGE_ID}" > "${BACKEND_DIR}/deploy/runtime-image.env"

docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  config

docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  run --rm migrate npm run migrate:status

docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  up -d --force-recreate main-service-api main-service-worker
```

PostgreSQL/Redis recreate edilmez. Volume silinmez. Redis flush yapilmaz. Git history rewrite yapilmaz.

Emergency rebuild fallback icin known-good commit ayri temporary server worktree'de checkout edilir, distinct immutable image olarak build edilir ve `runtime-image.env` o image ID'ye cevrilir. Sunucuda source dosyasi elle editlenmez.

Checkout hygiene ve release-pointer evidence contract [.docs/production-checkout-and-release-pointers.md](.docs/production-checkout-and-release-pointers.md) dosyasindadir. MS-019D-R1 external `operator-state/ms-019d/production-release-pointer-state.json` state'ini current verified pointer'dan forward-looking rollback baseline olarak kurdu; bu historical previous pointer degildir. Next production release rotation bu external state'i runtime mutation oncesi operator-authorized procedure icinde guncellemelidir; Codex handoff generation veya repository tests bu state file'i guncellemez.

## 17. Sorun giderme

### Uygulama calismiyor, nereye bakarim?

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  ps

docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  logs --tail=100 main-service-api

curl -fsS http://127.0.0.1:3200/health/ready
```

### Git pull neden reddedildi?

`git pull --ff-only`, remote history local branch uzerine temiz fast-forward edilemiyorsa durur. Operator merge veya rebase yapmaz; once `git status --short` ve `git log --oneline --decorate -n 20` ile durumu inceler.

### Sunucu working tree neden dirty?

```bash
cd /opt/habersoft-rss
git status --short
git diff --stat
```

Tracked dosya sunucuda degismisse deployment durur. Source dosyasi localden tekrar upload edilmez.

### API live ama ready degilse?

```bash
curl -fsS http://127.0.0.1:3200/health/live
curl -fsS http://127.0.0.1:3200/health/ready
docker compose --env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}" logs --tail=100 main-service-api
```

Ready response icinde PostgreSQL, Redis veya tenantAuth alt durumu incelenir.

### tenantAuth down ise?

```bash
grep '^TENANT_AUTH_JWKS_URL=' "${SHARED_ENV}"
curl -fsS https://auth.habersoft.com/.well-known/jwks.json
docker compose --env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}" logs --tail=100 main-service-api
```

JWKS URL HTTPS ve canonical production auth endpoint olmalidir. HTTP/local fixture kabul edilmez.

### Migration container failed ise?

```bash
docker compose --env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}" logs --tail=100 migrate
docker compose --env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}" run --rm migrate npm run migrate:status
```

`prisma db push` ile onarim yapilmaz.

### Worker scheduler gorunmuyorsa?

```bash
docker compose --env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}" exec main-service-worker npm run worker:health
docker compose --env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}" logs --tail=100 main-service-worker
```

Beklenen scheduler `cleanup.daily`, queue `main-service.maintenance`, job `cleanup.run.v1`.

### Port 3200 doluysa?

```bash
ss -ltnp | grep ':3200\b' || true
```

Factual conflict varsa `.env.production` icindeki `API_HOST_PORT` ve OpenLiteSpeed `rss.habersoft.com` upstream ayni yeni loopback portuna tasinir.

### docRoot neden bos?

Bu normaldir. OpenLiteSpeed docRoot sadece vhost referansidir. Uygulama Docker container'inda calisir ve trafik reverse proxy ile `127.0.0.1:3200` upstream'ine gider.

### Admin UI neden production active degil?

Repository artik `rss-admin-ui/` foundation project root'unu tasir, fakat bu MS-020A kapsaminda `FOUNDATION_ONLY - NOT_DEPLOYED` durumundadir. Real frontend vertical slice, auth/session contract ve production deployment ayrica onaylanmadan `rss-panel.habersoft.com` aktif sayilmaz.

### rss-panel neden acilmiyor?

`rss-panel.habersoft.com` planned/inactive durumdadir. Frontend uygulamasi yoktur, vhost activation claim'i yoktur.

### Bir onceki surume nasil donerim?

16. bolumdeki rollback kaydini kullan, `runtime-image.env` dosyasini onceki image ID'ye cevir, Compose config verify yap, migrate status calistir ve API/worker recreate et.

## 18. Guvenlik ve yasak islemler

Yasak islemler:

- source upload
- production secret commit
- direct public container port
- public PostgreSQL veya Redis portu
- `docker compose down -v`
- Docker global prune
- Redis flush
- `prisma db push`
- migration rewrite
- mutable `latest` image
- Git history rewrite
- Git tag veya GitHub Release
- artifact publication
- rss-panel active claim

Codex production SSH kullanmaz. Server Git, Docker, `.env.production`, OpenLiteSpeed, TLS ve DNS islemleri operator-managed kalir.

## 19. Operator production kabul kontrol listesi

Bu liste insan kaydidir; otomatik deployment claim'i degildir. Durum dili `PASSED`, `NOT_RECORDED` veya `NOT_APPLICABLE` gibi explicit degerler kullanir; bos alan success anlamina gelmez.

```text
deployment UTC date:
Git commit:
image ID:
migration status:
API live status:
API ready status:
worker health status:
OpenLiteSpeed vhost status:
TLS status:
public HTTPS status:
backup SHA-256:
rollback image ID:
operator name/role:
notes:
```

MS-018C current known activation snapshot:

```text
deployment UTC date: 2026-06-22
Git commit: NOT_RECORDED
image ID: NOT_RECORDED
image revision label: NOT_RECORDED
migration status: NOT_RECORDED
API live status: PASSED
API ready status: PASSED
internal dependencies: postgres=up, redis=up, tenantAuth=up
worker health status: NOT_RECORDED
scheduler inventory: NOT_RECORDED
OpenLiteSpeed vhost status: NOT_RECORDED
TLS status: NOT_RECORDED
public HTTPS status: PASSED
backup SHA-256: NOT_RECORDED
restore verification: NOT_RECORDED
current/previous pointers: NOT_RECORDED
restart/OOM point-in-time snapshot: NOT_RECORDED
bounded operational-smoke/error-signal: SUCCESS_GOVERNANCE_ACCEPTED
long-term stability: NOT_APPLICABLE_BY_GOVERNANCE_DECISION
artifact publication: NOT_PERFORMED
Git tag: NOT_CREATED
GitHub Release: NOT_CREATED
rss-panel.habersoft.com: NOT_IMPLEMENTED_INACTIVE
operator name/role: operator-confirmed transcript
notes: basic production activation acceptance passed; MS-019F closed by governance-approved sample timeline; historical previous pointer remains non-blocking NOT_RECORDED
```

Secret deger yazilmaz.

MS-019C current backup/restore evidence snapshot:

```text
production backup SHA-256: 1bc52dfbf43a4bdeed64c072ab6dbaaadcb09207bc6bd4958a4821ed67e871f8
returned authority SHA-256: f4147ec51fc686aa4c07e3f8c03f79c2bed089f51f191ca7d4db8e7232cc82f8
off-host restore receipt SHA-256: 84658697d04a357c9ba311562320b2fed893efcc81e87fc81fc8a8ca41cf9303
combined backup/restore receipt SHA-256: 868b13b9cfe44962daa4abbec71310473e1df1d0a49e4bf156a4c3f77ed01735
backup restore baseline: PASSED
status: PRODUCTION_BACKUP_RESTORE_VERIFIED
```

MS-019D-R1 current checkout/pointer evidence snapshot:

```text
checkout hygiene: PASSED
current pointer: PASSED
receipt SHA-256: e823ec819d471c8bb3c5052e6def3a6830731058952971675bdd4ae4d1f6c63a
returned authority SHA-256: 44be2ff5d3d666ba359ac0af9c206c593ab0a6e2cc0a5bc630f5079c9c4ad8a9
rollback baseline state SHA-256: ce6908a1196451c5737086943c4b9a9ad116ccc7d45c953fab6b2eb17936681c
historical previous pointer: NOT_RECORDED
outcome: PARTIAL_ACCEPTED
```

MS-019E-R2 current edge body-limit evidence snapshot:

```text
application body limit: 5242880 bytes
small internal/public: PASSED 401/401
exact-limit internal/public: PASSED 401/401 with full upload
limit+1 internal/public: PASSED 413/413
internal upper control: EARLY_REJECTION_413 uploaded 1900544 of 5242881 bytes
public upper control: FULL_UPLOAD_REJECTED_413 uploaded 5242881 bytes
receipt SHA-256: fabad4a60f1f284379e1cd903b582b53bfd1fcbf93af32e79a94a1efa6377244
returned authority SHA-256: 43fa65c0e9aadf860fc40179b4e64bccf4b3f18eeffedb1e324e0fcef3847622
historical blocked receipt SHA-256: 9bd74b14d50525d1f408deebbb19d8912e71b4d21fe7f23b41a602ba0f966965
vendor configured exact limit: NOT_RECORDED
outcome: PASSED
```

### 19.1 Read-only operational evidence handoff

MS-019B-R7 ile read-only operational evidence handoff-v2 tooling hazirlandi. Canonical contract [.docs/production-operational-evidence.md](.docs/production-operational-evidence.md) dosyasindadir. MS-019A handoff-v1 historical verification icin korunur; fresh operator rerun handoff-v2 ile yapilir.

Bu akisin siniri:

- Codex production SSH kullanmaz.
- Handoff bundle production evidence degildir.
- Operator collector'i production host uzerinde manuel calistirir.
- Collector production Compose context'i explicit `--env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}"` sekliyle baglar.
- Collector yalniz read-only allowlist kontrolleri yapar.
- Collector secret echo, raw env dump, raw log dump, backup, restore, deployment veya service mutation yapmaz.
- Output external operator-state alaninda tutulur ve Git'e commit edilmez.
- Successful collector output kendi basina repository status update degildir; local verifier ve sonraki bounded milestone yalniz kanitlanan alanlari gunceller.

Collector command shape:

```bash
cd /opt/habersoft-rss
<operator-approved-handoff-v2-dir>/collect-production-operational-evidence.sh \
  --repository-dir /opt/habersoft-rss \
  --compose-file deploy/production/compose.yaml \
  --shared-env .env.production \
  --runtime-image-env deploy/runtime-image.env \
  --output-dir <new-empty-output-dir>
```

Collector once production Compose context preflight'ini calistirir. Bu preflight blocked olursa migration ve worker health dependent kontrolleri `FAILED` degil `NOT_RUN` olarak siniflanir; bu invocation-context hatasini production runtime failure iddiasindan ayirir.

Returned bundle sonraki local verification milestone'unda `production-operational-evidence-receipt.json` uretmek icin kullanilir. Valid partial receipt full operational acceptance anlamina gelmez.

### 19.2 Read-only checkout and release-pointer handoff

MS-019D ile checkout hygiene ve current/previous release-pointer evidence icin read-only handoff-v1 tooling hazirlandi. MS-019D-R1 returned bundle intake current checkout hygiene ve current pointer evidence'i `PARTIAL_ACCEPTED` olarak kabul etti. Canonical contract ve receipt boundary [.docs/production-checkout-and-release-pointers.md](.docs/production-checkout-and-release-pointers.md) dosyasindadir.

Bu akisin siniri:

- Codex production SSH kullanmaz.
- Handoff bundle tek basina production evidence degildir; accepted receipt gerekir.
- Operator collector'i production host uzerinde manuel calistirir.
- Collector production Compose context'i explicit `--env-file "${SHARED_ENV}" --env-file "${IMAGE_ENV}" -f "${COMPOSE_FILE}"` sekliyle baglar.
- Collector Git checkout'u, runtime image pointer'i ve optional previous pointer file'i read-only sinifta inceler.
- Collector service mutation, migration, backup/restore, HTTP probe, raw env dump veya raw log dump yapmaz.
- Missing previous pointer `PREVIOUS_POINTER_NOT_RECORDED` olarak kalir; success diye infer edilmez.

Collector command shape:

```bash
cd /opt/habersoft-rss
<operator-approved-ms-019d-handoff-v1-dir>/collect-production-checkout-pointer-evidence.sh \
  --repository-dir /opt/habersoft-rss \
  --compose-file deploy/production/compose.yaml \
  --shared-env .env.production \
  --runtime-image-env deploy/runtime-image.env \
  --output-dir <new-empty-output-dir>
```

Previous pointer evidence varsa operator strict data file'i ayrica verir:

```bash
  --previous-pointer-file /opt/habersoft-rss/operator-state/ms-019d/previous-main-service-release.env
```

Returned bundle local verifier tarafindan `production-checkout-pointer-receipt.json` uretmek icin kullanilir. MS-019D-R1 receipt current checkout/current pointer alanlarini accepted hale getirdi; previous pointer absent oldugu icin full operational baseline hala partial kalir.

### 19.3 Read-only edge body-limit evidence

MS-019E-R2 ile public HTTPS edge request-body compatibility accepted durumdadir. Canonical contract, upper-control early-rejection semantics ve receipt boundary [.docs/production-edge-body-limit.md](.docs/production-edge-body-limit.md) dosyasindadir.

Bu akisin siniri:

- Codex production SSH kullanmaz.
- Handoff bundle tek basina production evidence degildir; accepted receipt gerekir. Current accepted receipt `production-edge-body-limit-receipt-v2.json` SHA-256 `fabad4a60f1f284379e1cd903b582b53bfd1fcbf93af32e79a94a1efa6377244` olarak kayitlidir.
- Operator collector'i production host veya approved production network context uzerinde manuel calistirir.
- Collector yalniz `POST /agent/entries` rotasina exact byte-sized invalid JSON body gonderir.
- Collector Agent key, tenant JWT, cookie, retry, concurrency, TLS bypass veya arbitrary target/size kullanmaz.
- Collector response body, headers, payload, config, logs veya secret retaining yapmaz.
- Output external operator-state alaninda tutulur ve Git'e commit edilmez.

Generated handoff dogrulama:

```bash
cd "<operator-approved-ms-019e-handoff-v1-dir>"
sha256sum -c checksums.sha256
bash -n collect-production-edge-body-limit-evidence.sh
```

Collector command shape:

```bash
<operator-approved-ms-019e-handoff-v1-dir>/collect-production-edge-body-limit-evidence.sh \
  --confirm-public-host rss.habersoft.com \
  --output-dir <new-empty-output-dir>
```

Returned bundle exactly su dosyalari icermelidir:

```text
checksums.sha256
collector-metadata.txt
evidence-records.tsv
```

Returned bundle local verifier tarafindan `production-edge-body-limit-receipt-v2.json` uretmek icin kullanilir. MS-019E-R2 receipt edge body-limit compatibility'i accepted hale getirdi. Exact vendor configured limit yine `NOT_RECORDED` kalir. Application body contract veya edge request-body config degisirse bu collector yeniden calistirilmalidir.

### 19.4 Bounded 20-minute operational-smoke and error-signal evidence

MS-019F-R5 ile bounded 20-minute operational-smoke ve machine-safe error-signal evidence current production status icin `SUCCESS_GOVERNANCE_ACCEPTED` olarak kapandi. Canonical strict/governance verifier boundary [.docs/production-operational-smoke-and-error-signals.md](.docs/production-operational-smoke-and-error-signals.md) dosyasindadir. Historical handoff-v1 governance tarafindan `HISTORICAL_SUPERSEDED_GOVERNANCE_REJECTED_NEVER_RUN` olarak emekliye ayrildi ve fresh run icin kullanilmaz.

Current accepted identity:

```text
selected v3 tree: 0ddc2021486d039718ca7d9350c0fca2f3bf6e467d8d01b1c9f087343c19c183
authority-v3 SHA-256: ea229cfd06862b293f64c63ddf4d2171b9e83be1d94afce21bcc746e004e97d3
governance decision SHA-256: 86d2f21ae78418cc00312ca4a18f6417cb2df4fb7314341d40b9c5ef344aed73
receipt-v4 SHA-256: 4146d93b99776f2d11c603b57dc60e728942c4fc56fbd8b8f5a41c2077acaa27
strict technical result: BLOCKED_ERROR_SIGNAL_BUCKET_SPAN_MISMATCH
governance strict result: PASSED
acceptance basis: GOVERNANCE_APPROVED_SAMPLE_TIMELINE_BASELINE_V1
```

Bu akisin siniri:

- Codex production SSH kullanmaz.
- Handoff bundle tek basina production evidence degildir; accepted receipt gerekir.
- Current MS-019F closeout icin yeni observer run istenmez.
- Observer 20 dakika / 1200 saniye boyunca 60 saniye primary interval ile 21 sample toplar.
- Worker health 300 saniye interval ile 5 sample olarak `docker compose exec -T main-service-worker npm run worker:health` uzerinden kontrol edilir.
- Error-signal contract yalniz stable severity-prefix classifier kullanir; raw log, log snippet, line hash veya broad `grep -i error` retained edilmez.
- Observer auth credential, cookie, retry, TLS bypass, deployment, restart, migration, backup, restore veya env/edge mutation yapmaz.
- Output external operator-state alaninda tutulur ve Git'e commit edilmez.
- Long-term stability, uptime SLO veya reliability claim uretmez; bu alan `NOT_APPLICABLE_BY_GOVERNANCE_DECISION` durumundadir.

Historical/generated handoff dogrulama shape'i:

```bash
cd <approved-ms-019f-handoff-v2-dir>
sha256sum -c checksums.sha256
bash -n observe-production-operational-smoke.sh
```

Archived observer command shape'i. Current MS-019F closeout icin yeniden calistirilmaz; future runtime mutation olursa then-current smoke/governance policy uygulanir:

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

Returned bundle exactly su dosyalari icermelidir:

```text
checksums.sha256
collector-metadata.txt
operational-smoke-samples.tsv
error-signal-buckets.tsv
```

Interrupted run valid checksum bundle uretmez. Current selected v3 bundle receipt-v4 ile accepted oldugu icin yeni v3/v4 run talep edilmez. Future runtime mutation icin bu R5 time-anomaly exception otomatik uygulanmaz; then-current bounded smoke contract ve explicit governance policy gerekir.

## 20. MS-020A repository topology boundary

Current repository topology:

```text
POLYREPO_STYLE_SINGLE_GIT_MONOREPO
```

Project roots:

```text
habersoft-rss/rss-habersoft-com
habersoft-rss/rss-admin-ui
```

Production runtime boundary:

```text
PRODUCTION_PATH_MIGRATION_NOT_PERFORMED_IN_MS-020A
```

MS-020A Git repository migration lands two project roots in the single canonical repository. It does not mutate current production runtime, does not activate `rss-panel.habersoft.com`, and does not make `rss-admin-ui` production active.

Future production path migration requirements:

- operator tarafindan ayrica yetkilendirilir,
- checkout root `/opt/habersoft-rss` olarak dogrulanir,
- backend komutlari `rss-habersoft-com` altindan calistirilir,
- production preflight, backup/evidence ve release gates yeniden calistirilir,
- admin UI ayrica approved deployment milestone olmadan yayinlanmaz.

Root guide: [../PRODUCTION.md](../PRODUCTION.md)

## 21. rss-panel.habersoft.com aktivasyon onkosullari

`rss-panel.habersoft.com` aktif degildir. Aktivasyon icin:

- real frontend implementation
- frontend build artifact veya image
- frontend health check
- OpenLiteSpeed vhost
- TLS
- public HTTPS acceptance
- staging rehearsal
- repo-local docs update

Bu kosullar tamamlanmadan `rss-panel.habersoft.com` production-ready sayilmaz.

## 22. Ilgili ayrintili belgeler

- [README.md](README.md)
- [.docs/README.md](.docs/README.md)
- [.docs/production-acceptance.md](.docs/production-acceptance.md)
- [.docs/production-operational-evidence.md](.docs/production-operational-evidence.md)
- [.docs/production-checkout-and-release-pointers.md](.docs/production-checkout-and-release-pointers.md)
- [.docs/production-edge-body-limit.md](.docs/production-edge-body-limit.md)
- [.docs/production-operational-smoke-and-error-signals.md](.docs/production-operational-smoke-and-error-signals.md)
- [.docs/production-deployment.md](.docs/production-deployment.md)
- [.docs/production-rollout-runbook.md](.docs/production-rollout-runbook.md)
- [.docs/release-packaging.md](.docs/release-packaging.md)
- [.docs/backup-and-restore.md](.docs/backup-and-restore.md)
- [.docs/service-handbook/README.md](.docs/service-handbook/README.md)
