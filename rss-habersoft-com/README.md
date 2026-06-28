# main-service

`main-service`, rss.habersoft.com ekosisteminin merkezi sunucu uygulamasidir.

Uygulanan urun ve operasyon belgeleri icin bkz. [.docs/README.md](.docs/README.md).

Servisleri sade bir entegrasyon okuma sirasiyla yeniden kavramak icin bkz. [.docs/service-handbook/README.md](.docs/service-handbook/README.md).

Production operator guide: [PRODUCTION.md](PRODUCTION.md). Bu dosya insan sunucu operatoru icindir; current production status ve evidence sahibi [.docs/production-acceptance.md](.docs/production-acceptance.md) dosyasidir.

Bu surum container tabanli API/worker iskeleti, config dogrulama, PostgreSQL/Redis baglanti siniri, health yuzeyi, canonical PostgreSQL business schema migration temeli, API process'ine ozel tenant RS256 JWT/JWKS dogrulama altyapisi, tenant feed abonelik endpoint'leri, tenant basina Redis rate limiting davranisi, `GET /api/entries` hafif liste endpoint'i, `GET /api/entries/{id}/detail` detail endpoint'i, Agent `X-Agent-Key` authentication altyapisi, `POST /agent/heartbeat` current-state endpoint'i, read-only `GET /agent/feeds/due` endpoint'i, read-only `POST /agent/feeds/{feed_id}/new-guids` endpoint'ini, idempotent `POST /agent/entries` ingestion endpoint'ini, idempotent batch `POST /agent/feed-check-results` outcome ingestion endpoint'ini, worker-only BullMQ cleanup job runner'ini ve production Compose/release package dogrulama araclarini icerir.

Application version: `0.1.0-ms-017`.
Application status: `MVP — Production Aktif`.
Master baseline: `rss-habersoft-master-v12`.

MS-022A repository-local source adds disabled-by-default admin auth/session routes for the not-deployed `rss-admin-ui` local full-stack rehearsal: `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout`. Backend admin auth defaults to `ADMIN_UI_AUTH_MODE=disabled`, has no default credential, and requires explicit `single_admin` configuration with a PBKDF2 password hash, session secret, Redis-backed server-side sessions, and an HttpOnly `SameSite=Lax` cookie. MS-022B adds secretless provisioning helpers and production activation validation docs for a future operator-authorized deployment, while the admin UI remains `MS-022B_PRODUCTION_ACTIVATION_PACKAGE_READY - NOT_DEPLOYED`. The backend package version remains `0.1.0-ms-017` because these routes are feature-gated, locally rehearsed only, and not production-activated by MS-022A/MS-022B.

Admin auth provisioning helpers:

```bash
npm run admin-auth:hash
npm run admin-auth:secret
npm run admin-auth:verify-config
```

The helpers use the current PBKDF2 admin password hash contract, generate/validate session secrets, validate production-like admin auth config, and redact sensitive values by default. Real production secrets must remain outside Git and outside Codex control. See [.docs/admin-auth-production-activation.md](.docs/admin-auth-production-activation.md).

MS-018C operator-confirmed evidence'e gore `main-service` backend production'da aktiftir: internal/public live ve ready checks HTTP `200`, PostgreSQL/Redis/tenantAuth readiness `up`, API loopback upstream `127.0.0.1:3200`.

MS-019B collector-v2 operational evidence receipt partial accepted durumdadir: explicit production Compose context, runtime Git/image identity, service/port policy, migration, worker/scheduler, health, boundary, redirect, TLS ve point-in-time restart/OOM evidence passed. MS-019C production backup/restore receipt `PRODUCTION_BACKUP_RESTORE_VERIFIED` durumundadir. MS-019D-R1 checkout hygiene ve current release pointer evidence'i `PARTIAL_ACCEPTED` olarak kabul etti; forward rollback baseline state current pointer'dan external olarak kuruldu. MS-019E-R2 edge body-limit compatibility evidence'i `PASSED` durumundadir. MS-019F-R5 bounded 20-minute operational-smoke ve machine-safe error-signal evidence'i selected v3 sample timeline governance karariyla `SUCCESS_GOVERNANCE_ACCEPTED` durumundadir. Historical previous production pointer `NOT_RECORDED` ve non-blocking kalir; long-term stability evidence ise `NOT_APPLICABLE_BY_GOVERNANCE_DECISION` durumundadir. MS-020B ile `rss-admin-ui` read-only status dashboard contract'i repository-local olarak uygulanmistir, fakat admin UI production deployment ve `rss-panel.habersoft.com` aktivasyonu yapilmamistir. Contract ve receipt verifier semantics [.docs/production-operational-evidence.md](.docs/production-operational-evidence.md), [.docs/backup-and-restore.md](.docs/backup-and-restore.md), [.docs/production-checkout-and-release-pointers.md](.docs/production-checkout-and-release-pointers.md), [.docs/production-edge-body-limit.md](.docs/production-edge-body-limit.md) ve [.docs/production-operational-smoke-and-error-signals.md](.docs/production-operational-smoke-and-error-signals.md) dosyalarindadir.

MS-017C staging drill tarihsel kanittir: `STAGING_USES_PRODUCTION_IDP` decision altinda approved staging target'ta candidate deployment, synthetic sentinel, PostgreSQL `pg_dump -Fc` backup, off-host restore verification, rollback to `0.1.0-ms-016`, roll-forward to `0.1.0-ms-017`, final current pointer promotion ve final running services acceptance passed. Staging package source/image kimlikleri production identity degildir.

External registry publish, Git tag ve GitHub Release yapilmamistir. Frontend, `rss-panel.habersoft.com`, bagimsiz Agent application ve bagimsiz Tenant applications bu backend status claim'inin kapsami disindadir. Public route inventory, schema ve migrations degismemistir.
