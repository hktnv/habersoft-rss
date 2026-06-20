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
- `migrate`: PostgreSQL saglikli olduktan sonra `prisma migrate deploy` calistiran sonlu gorev.
- `main-service-api`: NestJS HTTP API process'i. Bu milestone'da yalnizca health endpoint'lerini sunar.
- `main-service-worker`: HTTP listener acmayan Nest application context. Config, PostgreSQL ve Redis baglantilarini bootstrap eder; BullMQ consumer, cleanup scheduler veya business job calistirmaz.

## Sabit Image Surumleri

- Application image base: `node:24.17.0-bookworm-slim`
- PostgreSQL: `postgres:17.9-bookworm`
- Redis: `redis:8.8.0-trixie`

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

`/health/live` yalnizca API process'inin HTTP istegine cevap verdigini gosterir. `/health/ready` PostgreSQL ve Redis erisilebilir oldugunda `200`, aksi halde secret veya low-level hata detayi sizdirmadan `503` doner.

## Kalite Komutlari

Bu komutlar container toolchain'i ile calistirilir:

```powershell
docker compose run --rm main-service-api npm run lint
docker compose run --rm main-service-api npm run typecheck
docker compose run --rm main-service-api npm test
docker compose run --rm main-service-api npm run test:db
docker compose run --rm main-service-api npm run test:all
docker compose run --rm main-service-api npm run build
```

`npm run test:db`, Compose PostgreSQL servisi uzerinde izole gecici bir database olusturur, migration'lari bastan uygular, ikinci deploy'un no-op oldugunu dogrular, katalog/constraint/index kontrollerini calistirir ve gecici database'i siler.

## Smoke Test

MS-001 icin calistirilan smoke adimlari:

```powershell
docker compose config
docker compose build
docker compose up -d
docker compose ps
Invoke-WebRequest http://localhost:3000/health/live
Invoke-WebRequest http://localhost:3000/health/ready
docker compose port main-service-worker 3000
docker compose down
```

Worker servisinde public HTTP portu yayimlanmaz. `docker compose port main-service-worker 3000` port bulunmadigini gostermelidir.

## Worker Scheduler Durumu

Bu milestone worker scheduler implementasyonu degildir. Worker process'i yalnizca standalone Nest application context olarak acilir, PostgreSQL ve Redis baglantilarini dogrular ve SIGTERM/SIGINT sirasinda kontrollu kapanir. BullMQ scheduler inventory reconciliation, cleanup job ve worker readiness ayrintilari sonraki bounded milestone'a birakilmistir.
