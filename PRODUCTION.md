# Habersoft RSS Production Operator Guide

## 1. Belgenin amaci ve otoritesi

Bu belge, `habersoft-rss` repository'sinin production sunucusunda Git tabanli olarak nasil alinacagini, nasil build edilecegini, nasil calistirilacagini, nasil dogrulanacagini ve sorun durumunda nasil geri alinacagini aciklar.

Bu belge insan operator icindir. Codex production sunucusuna SSH baglanmaz, source upload etmez, Docker/OpenLiteSpeed/DNS/TLS komutu calistirmaz ve production deployment yaptigini iddia etmez.

Current main-service production activation status ve operator-confirmed evidence'in canonical repository-local sahibi [.docs/production-acceptance.md](.docs/production-acceptance.md) dosyasidir. Bu guide yeniden kullanilabilir operator prosedurudur; kendi basina success receipt degildir.

Current application status: `MVP — Production Aktif`.

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

Mevcut backend-only faz:

```text
/opt/habersoft-rss/
|-- PRODUCTION.md
|-- package.json
|-- src/
|-- prisma/
|-- deploy/
`-- .docs/
```

Gelecek monorepo fazi:

```text
/opt/habersoft-rss/
|-- PRODUCTION.md
|-- backend/
`-- frontend/
```

Komutlar su otomatik backend dizin secimini kullanir:

```bash
REPO_DIR=/opt/habersoft-rss

if [ -f "$REPO_DIR/backend/package.json" ]; then
  BACKEND_DIR="$REPO_DIR/backend"
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
- `MAIN_SERVICE_IMAGE` absent

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

Compose config dogrulama:

```bash
docker compose \
  --env-file "${SHARED_ENV}" \
  --env-file "${IMAGE_ENV}" \
  -f "${COMPOSE_FILE}" \
  config
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

### Frontend klasoru neden yok?

Bu faz backend-only repository layout kullanir. `frontend/` gelecek monorepo/frontend milestone'unda eklenecektir.

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
restart/OOM/stability: NOT_RECORDED
artifact publication: NOT_PERFORMED
Git tag: NOT_CREATED
GitHub Release: NOT_CREATED
rss-panel.habersoft.com: NOT_IMPLEMENTED_INACTIVE
operator name/role: operator-confirmed transcript
notes: basic production activation acceptance passed; extended operational acceptance partial/not fully recorded
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

## 20. Gelecek backend/frontend monorepo gecisi

Current phase:

```text
backend-only repository layout
```

Target phase:

```text
habersoft-rss/backend
habersoft-rss/frontend
```

Activation trigger:

```text
rss.habersoft.com backend is already stable in production
and a real frontend implementation milestone is approved
```

Future migration requirements:

- `git mv` ile history korunur.
- Docker context ve scriptler guncellenir.
- Relative docs linkleri guncellenir.
- CI/test komutlari guncellenir.
- Frontend package, Dockerfile ve health eklenir.
- Root monorepo README eklenir.
- Root orchestration yalniz frontend gercekten varsa eklenir.
- Production oncesi staging rehearsal yapilir.
- Monorepo governance aktiflesirse master polyrepo/monorepo sozlesmeleri guncellenir.

Bu milestone monorepo migration yapmaz.

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
- [.docs/production-deployment.md](.docs/production-deployment.md)
- [.docs/production-rollout-runbook.md](.docs/production-rollout-runbook.md)
- [.docs/release-packaging.md](.docs/release-packaging.md)
- [.docs/backup-and-restore.md](.docs/backup-and-restore.md)
- [.docs/service-handbook/README.md](.docs/service-handbook/README.md)
