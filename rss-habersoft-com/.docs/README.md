# main-service PROD Dokumantasyon Girisi

## Uygulama ve Repository Siniri

- Uygulama kimligi: `main-service`
- Repository siniri: bu `main-service` application repository'si
- Canonical repository remote: `https://github.com/hktnv/habersoft-rss`
- PROD dokuman seti sorumlulugu: Bu repository'de gercekten uygulanmis main-service surumunun kurulum, calistirma, dogrulama ve operasyon gercegini aciklamak.
- Belge sahibi: `Main Service Teknik Sahibi`
- Uygulama surumu/durum: `0.1.0-ms-017` / `MVP — Production Aktif`

Bu repository, merkezi `.md/` DEV dokuman agacindan ayri bir application repository siniridir. Merkezi master ve DEV alt dokumanlar bu repository'ye kopyalanmaz.

## Aktif PROD Belge Envanteri

| Belge | Sorumluluk |
|---|---|
| [README.md](README.md) | Repository-local PROD dokumantasyon girisi, envanter ve uyum kaydi. |
| [../PRODUCTION.md](../PRODUCTION.md) | Git-only production source delivery, operator Git pull/build/run, OpenLiteSpeed handoff ve kabul checklist'i. |
| [production-acceptance.md](production-acceptance.md) | Current production activation status, operator-confirmed evidence, external receipt identity ve claim boundary. |
| [production-operational-evidence.md](production-operational-evidence.md) | MS-019B-R8 accepted collector-v2 operational evidence receipt, operator handoff bundle, collector safety ve receipt verifier semantics. |
| [production-checkout-and-release-pointers.md](production-checkout-and-release-pointers.md) | MS-019D production checkout hygiene, current/previous release-pointer evidence contract, read-only operator handoff-v1 ve receipt verifier semantics. |
| [production-edge-body-limit.md](production-edge-body-limit.md) | MS-019E public HTTPS edge request-body compatibility evidence, exact Agent entries body contract, safe collector ve receipt verifier semantics. |
| [production-operational-smoke-and-error-signals.md](production-operational-smoke-and-error-signals.md) | MS-019F bounded 20-minute operational-smoke ve machine-safe error-signal handoff-v2 contract, strict/governance verifier semantics ve receipt-v4 closeout. |
| [repository-conventions.md](repository-conventions.md) | Windows checkout, `.gitattributes`, POSIX shell LF, safe renormalize ve production guide mirror byte-equality sozlesmesi. |
| [service-handbook/README.md](service-handbook/README.md) | Sade servis el kitabi girisi, aktorler ve okuma sirasi. |
| [service-handbook/main-servis-kilavuzu.md](service-handbook/main-servis-kilavuzu.md) | Main-service runtime rolleri, veri iliskileri, port modeli ve operasyon sinirlari. |
| [service-handbook/agent-servis-kilavuzu.md](service-handbook/agent-servis-kilavuzu.md) | Agent entegrasyon akisi, auth siniri, idempotency ve yapmamasi gerekenler. |
| [service-handbook/tenant-servis-kilavuzu.md](service-handbook/tenant-servis-kilavuzu.md) | Tenant kimligi, izolasyon, JWT/JWKS ve public API kullanim ozeti. |
| [local-development.md](local-development.md) | Gercek yerel container gelistirme, calistirma, local JWKS fixture ve dogrulama komutlari. |
| [admin-auth-production-activation.md](admin-auth-production-activation.md) | MS-024D admin auth secretless provisioning helpers, backend API runtime env wiring, local RC boundary and future operator activation checklist. |
| [database-schema.md](database-schema.md) | MS-002 canonical PostgreSQL business schema, migration ve DB test gercegi. |
| [tenant-authentication.md](tenant-authentication.md) | MS-003 tenant RS256 JWT/JWKS dogrulama altyapisi, readiness ve sinirlar. |
| [tenant-feed-subscriptions.md](tenant-feed-subscriptions.md) | MS-004 tenant feed abonelik endpoint'leri, tenant izolasyonu, transaction ve sinirlar. |
| [tenant-rate-limiting.md](tenant-rate-limiting.md) | MS-005 Tenant API feed rotalarinda tenant basina Redis rate limiting davranisi ve sinirlari. |
| [tenant-entry-listing.md](tenant-entry-listing.md) | MS-006 Tenant entry listeleme API route, pagination, visibility, query/projection ve test gercegi. |
| [tenant-entry-detail.md](tenant-entry-detail.md) | MS-007 Tenant entry detail API route, visibility, retention/null/404 ayrimi, query/projection ve invariant test gercegi. |
| [agent-authentication.md](agent-authentication.md) | MS-008 Agent API `X-Agent-Key` authentication altyapisi, API-only secret siniri ve route-level guard davranisi. |
| [agent-heartbeat.md](agent-heartbeat.md) | MS-009 `POST /agent/heartbeat` endpoint'i, request validation, current-state upsert ve no-side-effect sinirlari. |
| [agent-due-feeds.md](agent-due-feeds.md) | MS-010 `GET /agent/feeds/due` endpoint'i, strict limit validation, due eligibility, order, limit+1/has_more ve read-only sinirlari. |
| [agent-new-guid-filtering.md](agent-new-guid-filtering.md) | MS-011 `POST /agent/feeds/{feed_id}/new-guids` endpoint'i, strict request validation, duplicate/order policy, advisory DB filter ve no-side-effect sinirlari. |
| [agent-entry-ingestion.md](agent-entry-ingestion.md) | MS-012 `POST /agent/entries` endpoint'i, strict validation, idempotent replay, atomic entry/detail/event/feed-state write ve checked_at window sinirlari. |
| [agent-feed-check-results.md](agent-feed-check-results.md) | MS-013 `POST /agent/feed-check-results` endpoint'i, strict validation, idempotent batch replay, out-of-order accounting ve monotonic feed-state write sinirlari. |
| [background-job-runner.md](background-job-runner.md) | MS-014 worker-only BullMQ queue, scheduler reconciliation, retry, readiness ve shutdown gercegi. |
| [cleanup-retention.md](cleanup-retention.md) | MS-014 cleanup retention orkestrasyonu, canonical step sirasi, bounded SQL davranisi ve telemetry siniri. |
| [mvp-release-readiness.md](mvp-release-readiness.md) | MS-015 MVP adayinin release-blocker tanimi, kabul komutlari, gate matrisi, clean-room yontemi ve residual risk siniri. |
| [production-deployment.md](production-deployment.md) | Single-host production Compose topology, Git-only source/build modeli, service/network/port/volume/startup/readiness ve active production siniri. |
| [release-packaging.md](release-packaging.md) | MS-016 release package command, artifact inventory, manifest/checksum/SBOM/provenance, image identity, verifier ve publication/deployment ayrimi. |
| [backup-and-restore.md](backup-and-restore.md) | MS-019C production PostgreSQL backup/restore evidence, checksum metadata, disposable restore verification, Redis siniri ve rollback data-protection gate'i. |
| [staging-deployment-and-rollback.md](staging-deployment-and-rollback.md) | MS-017 staging target preflight, deployment/rollback tatbikati icin target safety, SSH, receipt ve remote staging operasyon gercegi. |
| [staging-host-provisioning.md](staging-host-provisioning.md) | MS-017B3 staging host prerequisite, operator responsibility, handoff bundle artifact model and external input contract. |
| [local-staging-rehearsal.md](local-staging-rehearsal.md) | MS-017B2 izole local Docker rehearsal, package/image rollback dry-run, backup/restore ve remote staging'den ayrim. |
| [production-rollout-runbook.md](production-rollout-runbook.md) | Kontrollu production rollout, kabul, rollback ve blocked-handoff proseduru. |

## Yeni Baslayanlar Icin Okuma Yolu

1. [service-handbook/README.md](service-handbook/README.md)
2. [service-handbook/main-servis-kilavuzu.md](service-handbook/main-servis-kilavuzu.md)
3. [service-handbook/agent-servis-kilavuzu.md](service-handbook/agent-servis-kilavuzu.md)
4. [service-handbook/tenant-servis-kilavuzu.md](service-handbook/tenant-servis-kilavuzu.md)
5. [production-acceptance.md](production-acceptance.md)
6. [production-operational-evidence.md](production-operational-evidence.md)
7. [production-checkout-and-release-pointers.md](production-checkout-and-release-pointers.md)
8. [production-edge-body-limit.md](production-edge-body-limit.md)
9. [production-operational-smoke-and-error-signals.md](production-operational-smoke-and-error-signals.md)
10. [repository-conventions.md](repository-conventions.md)
11. [../PRODUCTION.md](../PRODUCTION.md)
12. [production-deployment.md](production-deployment.md)
13. [release-packaging.md](release-packaging.md)
14. [backup-and-restore.md](backup-and-restore.md)
15. [staging-deployment-and-rollback.md](staging-deployment-and-rollback.md)

## Okuma Sirasi

1. [README.md](README.md)
2. [../PRODUCTION.md](../PRODUCTION.md)
3. [production-acceptance.md](production-acceptance.md)
4. [production-operational-evidence.md](production-operational-evidence.md)
5. [production-checkout-and-release-pointers.md](production-checkout-and-release-pointers.md)
6. [production-edge-body-limit.md](production-edge-body-limit.md)
7. [production-operational-smoke-and-error-signals.md](production-operational-smoke-and-error-signals.md)
8. [repository-conventions.md](repository-conventions.md)
9. [local-development.md](local-development.md)
10. [admin-auth-production-activation.md](admin-auth-production-activation.md)
11. [tenant-authentication.md](tenant-authentication.md)
12. [tenant-feed-subscriptions.md](tenant-feed-subscriptions.md)
13. [tenant-rate-limiting.md](tenant-rate-limiting.md)
14. [tenant-entry-listing.md](tenant-entry-listing.md)
15. [tenant-entry-detail.md](tenant-entry-detail.md)
16. [agent-authentication.md](agent-authentication.md)
17. [agent-heartbeat.md](agent-heartbeat.md)
18. [agent-due-feeds.md](agent-due-feeds.md)
19. [agent-new-guid-filtering.md](agent-new-guid-filtering.md)
20. [agent-entry-ingestion.md](agent-entry-ingestion.md)
21. [agent-feed-check-results.md](agent-feed-check-results.md)
22. [background-job-runner.md](background-job-runner.md)
23. [cleanup-retention.md](cleanup-retention.md)
24. [mvp-release-readiness.md](mvp-release-readiness.md)
25. [production-deployment.md](production-deployment.md)
26. [release-packaging.md](release-packaging.md)
27. [backup-and-restore.md](backup-and-restore.md)
28. [staging-deployment-and-rollback.md](staging-deployment-and-rollback.md)
29. [staging-host-provisioning.md](staging-host-provisioning.md)
30. [local-staging-rehearsal.md](local-staging-rehearsal.md)
31. [production-rollout-runbook.md](production-rollout-runbook.md)
32. [database-schema.md](database-schema.md)
33. Repository kok [README.md](../README.md)

## Master/DEV Uyum Kaydi

Bu `.docs/` kumesi, merkezi [Polyrepo DEV ve PROD Dokumantasyon Sozlesmesi](../../.md/master/00-POLYREPO-DEV-VE-PROD-DOKUMANTASYON-SOZLESMESI.md) ile uyumlu olacak sekilde yalnizca uygulanmis repository gercegini aciklar. Sistem capindaki master sozlesmeleri degistirmez.

- Uygulama kimligi: `main-service`
- Repository: `https://github.com/hktnv/habersoft-rss`
- Uygulama surumu: `0.1.0-ms-017`
- Master kaynak: `../../.md/master/`
- Master baseline: `rss-habersoft-master-v12`
- Master agac ozeti SHA-256: `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430`
- Ilgili DEV alt kumesi: `../../.md/sub-docs/main-service/`
- Uyum durumu: `MVP — Production Aktif`

`MVP — Production Aktif`, MS-018C operator-confirmed internal/public live-ready evidence ile yalniz `main-service` backend application'in production'da active oldugunu belirtir. MS-019B collector-v2 receipt exact production commit/image, worker/scheduler, TLS detail ve point-in-time restart/OOM evidence alanlarini kaydetti; MS-019C production backup/restore receipt `PRODUCTION_BACKUP_RESTORE_VERIFIED` durumundadir. MS-019D-R1 checkout hygiene ve current pointer evidence'i `PARTIAL_ACCEPTED` olarak kabul etti. MS-019E-R2 edge body-limit compatibility evidence'i `PASSED` durumundadir. MS-019F-R5 bounded operational-smoke/error-signal evidence'i exact v3 sample timeline governance karariyla `SUCCESS_GOVERNANCE_ACCEPTED` durumundadir. Historical previous pointer `NOT_RECORDED` ve `NON_BLOCKING_HISTORICAL_EVIDENCE_GAP` olarak kalir; long-term stability evidence `NOT_APPLICABLE_BY_GOVERNANCE_DECISION` durumundadir. Artifact publication, Git tag, GitHub Release, Agent application readiness veya Tenant application readiness iddiasi degildir. MS-020B ile `rss-admin-ui` read-only status dashboard contract'i repository-local olarak uygulanmistir, fakat admin UI production deployment ve `rss-panel.habersoft.com` aktivasyonu yapilmamistir.

v11 etki notu: MS-014 uygulamasi v11 master cleanup, retention ve job-runner sozlesmeleriyle uyumludur. `POST /agent/feed-check-results` response'u MS-013'te v11 dort-sayac sozlesmesini `accepted`, `feed_state_updated`, `idempotent_replay_count` ve `out_of_order_result_count` olarak uygulamaya devam eder.

v12 etki notu: MS-016 production deployment karari master `23-uretim-deployment-gorunumu.md` ile kapanmistir. Release package identity canonical master hash ile hizalanmistir; staging-handoff paketi image artifact dahil edildiginde dogrulanir. Registry publish, Git tag ve GitHub Release yapilmamistir.

MS-018B Git production handoff notu: Production source delivery Git-only olarak kanoniklestirildi. Lokal source tree scp/rsync/SFTP/ZIP/panel upload ile sunucuya tasinmaz; operator `origin/main` uzerinden `git pull --ff-only`, server-local Docker build, generated `runtime-image.env`, Compose migrate/up ve OpenLiteSpeed reverse proxy akisini [../PRODUCTION.md](../PRODUCTION.md) ile uygular. Codex production SSH kullanmaz ve server Git/Docker/OpenLiteSpeed/TLS islemleri operator-managed kalir. Frontend ve `rss-panel.habersoft.com` planned/inactive durumdadir.

MS-018C production activation notu: Operator 2026-06-22 tarihinde internal loopback ve public HTTPS `/health/live` ile `/health/ready` checks icin HTTP `200`, `status=live/ready`, `postgres=up`, `redis=up` ve `tenantAuth=up` kanitini verdi. Current production status ve external receipt kimligi [production-acceptance.md](production-acceptance.md) dosyasinda kanoniktir. MS-019B collector-v2 receipt runtime identity, worker/scheduler, TLS detail ve point-in-time restart/OOM evidence alanlarini kaydetti; MS-019C backup/restore evidence verified oldu; MS-019D-R1 checkout hygiene ve current pointer evidence'i accepted hale getirdi; MS-019E-R2 edge body-limit compatibility evidence'i accepted hale getirdi. MS-019F-R5 bounded 20-minute operational-smoke ve machine-safe error-signal evidence'i selected v3 tree `0ddc2021486d039718ca7d9350c0fca2f3bf6e467d8d01b1c9f087343c19c183`, governance decision SHA-256 `86d2f21ae78418cc00312ca4a18f6417cb2df4fb7314341d40b9c5ef344aed73` ve receipt-v4 SHA-256 `4146d93b99776f2d11c603b57dc60e728942c4fc56fbd8b8f5a41c2077acaa27` ile accepted hale getirdi. Previous pointer `NOT_RECORDED` fakat non-blocking, long-term stability evidence `NOT_APPLICABLE_BY_GOVERNANCE_DECISION` kalir.

MS-019B-R8 operational evidence receipt notu: [production-operational-evidence.md](production-operational-evidence.md) read-only collector/handoff-v2 contract'inin ve receipt verifier semantics'in sahibidir. Fresh collector-v2 returned bundle local olarak intake edildi; structural receipt verification passed, full operational baseline previous pointer evidence eksikligi nedeniyle partial kalir. Codex production'a baglanmadi, returned evidence dosyalarini degistirmedi ve production mutation/deploy/backup/restore/publication yapmadi.

MS-019C backup/restore evidence notu: [backup-and-restore.md](backup-and-restore.md) production returned backup-v2 authority, off-host disposable restore receipt ve combined receipt identity'sinin sahibidir. Backup restore baseline `PASSED`; raw dump, metadata, restore receipt ve operator-state artifacts external kalir ve Git'e commit edilmez.

MS-019D-R1 checkout/pointer receipt notu: [production-checkout-and-release-pointers.md](production-checkout-and-release-pointers.md) production checkout hygiene ve current/previous release-pointer evidence contract'inin sahibidir. Returned handoff-v1 bundle local olarak intake edildi; checkout hygiene ve current pointer `PASSED`, outcome `PARTIAL_ACCEPTED`, rollback baseline `ESTABLISHED_FROM_CURRENT_POINTER` durumundadir. Historical previous pointer `NOT_RECORDED` ve non-blocking olarak kalir; bounded operational-smoke/error-signal evidence MS-019F-R5 ile accepted, long-term stability evidence `NOT_APPLICABLE_BY_GOVERNANCE_DECISION` durumundadir.

MS-019E-R2 edge body-limit receipt notu: [production-edge-body-limit.md](production-edge-body-limit.md) public HTTPS edge request-body compatibility evidence ve verifier semantics'in sahibidir. Exact application body limit `5242880` byte olarak dogrulandi; returned bundle local olarak intake edildi; `production-edge-body-limit-receipt-v2.json` SHA-256 `fabad4a60f1f284379e1cd903b582b53bfd1fcbf93af32e79a94a1efa6377244` ile strict compatibility `SUCCESS` oldu. Exact vendor configured limit `NOT_RECORDED` kalir.

MS-019F-R5 operational-smoke/error-signal closeout notu: [production-operational-smoke-and-error-signals.md](production-operational-smoke-and-error-signals.md) 20-minute read-only observer, stable severity-prefix classifier, handoff-v2 bundle, strict technical verifier ve governance receipt-v4 semantics'in sahibidir. R4 strict technical result `BLOCKED_ERROR_SIGNAL_BUCKET_SPAN_MISMATCH` olarak korunur; R5 governance strict verifier selected v3 sample timeline basis ile `PASSED` oldu. Codex production'a baglanmadi, observer calistirmadi, returned evidence dosyalarini degistirmedi ve long-term stability evidence `NOT_APPLICABLE_BY_GOVERNANCE_DECISION` kalir.

MS-019B hygiene prep notu: [repository-conventions.md](repository-conventions.md), Windows `core.autocrlf`, `.gitattributes`, POSIX shell LF ve production guide mirror byte-equality sozlesmesinin canonical repository-local sahibidir. Bu hazirlik notu R8 returned evidence intake tarafindan superseded edildi; current operational receipt status [production-acceptance.md](production-acceptance.md) ve [production-operational-evidence.md](production-operational-evidence.md) dosyalarindadir.

MS-017C candidate notu: Approved staging target preflight kaniti uzerinden `0.1.0-ms-017` candidate package'i tam staging drill icin kullanilir. Staging deployment, rollback ve roll-forward evidence commit'i remote drill full success sonrasi yazilir.

MS-017C1 incident notu: Ilk approved staging candidate attempt, migrate success ve `/health/live` 200 sonrasinda `/health/ready` 503 / tenantAuth `down` ile durdu. Root cause `OPERATOR_JWKS_CONFIG_INVALID`: external staging env JWKS endpoint'i HTTPS ve canonical path tasidi, fakat canonical auth hostname sinirinda degildi ve local/remote host/candidate image network probe'larinda DNS failure verdi. Canonical auth JWKS endpoint ayni katmanlarda HTTPS/TLS/JSON/RS256 shape kontrollerinden gecti. Repository source fix gerekmedi; full staging deployment, sentinel, backup, rollback, roll-forward, production deployment, artifact publication, Git tag ve GitHub Release yapilmadi.

MS-017C1A karar notu: `auth-staging.habersoft.com` kaniti approved staging IdP contract'i olarak kabul edilmedi. Decision outcome `AUTH_STAGING_HTTP_UPSTREAM_ONLY`: remote host HTTP port 3000 uzerinden valid JWKS gorebildi, fakat staging HTTPS JWKS edge, issuer/audience/scope/token-acquisition contract'i ve candidate image DNS/HTTPS erisimi eksik. Remote readiness retry, full staging deployment, production deployment ve artifact publication yapilmadi.

MS-017C1A-R credential rotation notu: rotated external staging credential set secret degeri veya current hash/fingerprint aciklanmadan local ve remote canonical env uzerinde dogrulandi. Remote canonical env atomik olarak yenilendi, mode `0600` dogrulandi ve preserved PostgreSQL volume rotated role credential ile read-only TCP auth proof verdi. Shared env icindeki legacy `MAIN_SERVICE_IMAGE` operator-managed kaldigi icin image identity gate'i henuz kapanmamisti; staging HTTPS JWKS edge ve authoritative IdP contract eksik oldugundan readiness retry, full staging deployment, production deployment ve artifact publication yapilmadi.

MS-017C1A-R2 package image-binding notu: `MAIN_SERVICE_IMAGE` shared staging env sahibi olmaktan cikarildi ve candidate package `deploy/runtime-image.env` artifact'i tarafindan sahiplenildi. Commit `074d868d09c5b3d6079803480760d9e669b51826` package'i loaded image ID `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919` ile local ve remote config-only proof'tan gecti. Remote shared env `MAIN_SERVICE_IMAGE` icermiyor; previous/candidate runtime image env dosyalari loaded image ID'lerinden uretildi ve Compose resolution `previous -> candidate -> previous -> candidate` sirasi ile dogrulandi. API/worker/PostgreSQL/Redis baslatilmadi, readiness retry/full staging deployment/production deployment/artifact publication yapilmadi.

MS-017C1A-3V contract-pinned validator notu: External staging authorization contract accepted ve `STAGING_USES_PRODUCTION_IDP` karari raw/normalized SHA-256 pinleriyle local validator'a baglandi. `TENANT_AUTH_JWKS_URL=https://auth.habersoft.com/.well-known/jwks.json` staging'de yalniz verified contract ile kabul edilir; `auth-staging.habersoft.com`, HTTP/local fixture ve diger alanlardaki production identifier'lar rejected kalir. Runtime auth source, application version ve master baseline degismedi. Real staging env mutation, remote readiness-only proof, full staging deployment, production deployment ve artifact publication yapilmadi.

MS-017C1A-3R production IdP readiness-only notu: Active staging IdP decision `STAGING_USES_PRODUCTION_IDP` olarak dogrulandi ve canonical production JWKS `https://auth.habersoft.com/.well-known/jwks.json` local host, remote host, candidate image default bridge ve target project network katmanlarinda strict HTTPS/JWKS proof'tan gecti. Candidate source `074d868d09c5b3d6079803480760d9e669b51826`, package SHA-256 `b319c5daf031332f0a68b35774d58f537dd580cba279472a0d270b1a1c5fb082`, image ID `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919` ve runtime-image.env SHA-256 `b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873` ile dogrulandi. Preserved PostgreSQL/Redis volumes uzerinde migrate no-op, API readiness iki tur, `tenantAuth=up/postgres=up/redis=up`, worker isolation ve auth boundary smoke passed. Full staging deployment kabul edilmedi; sentinel, backup/restore, rollback/roll-forward, current symlink promotion, production deployment ve artifact publication yapilmadi. Final active staging service `none`, volumes preserved.

MS-017C full staging drill notu: 2026-06-22 UTC tarihinde target alias `habersoft-rss-staging-alias` uzerinde strict preflight passed: Linux `linux/amd64`, Docker/Compose ready, project `existing-approved-staging`, running containers `0`, API listener `0`, volumes `2`, filesystem `read-write`, inventory unchanged. Candidate `0.1.0-ms-017` source `074d868d09c5b3d6079803480760d9e669b51826`, package SHA-256 `b319c5daf031332f0a68b35774d58f537dd580cba279472a0d270b1a1c5fb082`, image ID `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919` ve runtime-image.env SHA-256 `b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873` ile deployed edildi. Previous rollback target `0.1.0-ms-016` source `9bed749e531fdbe435011b3948ec52982387269e`, package SHA-256 `fe68dd586c9c0efe105de110fee00acb6a71adb087da45a63fdc51ed32dafd0b`, image ID `sha256:4badab61265f0545ce945098220068238e05b1f7fda008fd1f853d75858a5b42` ve generated runtime-image.env SHA-256 `d9885d838af2a02aabd32ea11a7703b05b4da44b55e5add6c88d7141a4dea296` ile verified oldu. Synthetic sentinel alias SHA-256 `89024679ad934d5cfa85e401c365b686c49542b712f9fd06d26f3fdbac47ff92`, expected table counts `1/1/1/1/1/1`, backup SHA-256 `595ee0617d86f5886aca25ae99486f064ce06e081d16fec19fec74cdd8db9bfc`, off-host restore verification, rollback readiness `2`, roll-forward readiness `2`, final `current=candidate`, `previous=0.1.0-ms-016`, final active version `0.1.0-ms-017`, final services running and loopback-only public port policy passed. Production deployment, artifact publication, Git tag, GitHub Release, DNS/TLS/CyberPanel live change yapilmadi.

MS-017B1 notu: Staging operator input tooling prepared. Operator external target/env/known_hosts girdilerini local-only scaffold ve verify komutlariyla hazirlayabilir. Remote staging preflight not executed; staging deployment still not executed.

MS-017B2 evidence notu: Local isolated staging rehearsal passed with previous source `9bed749e531fdbe435011b3948ec52982387269e` and runtime candidate source `b992e77353aef6138afef19620a9d38835f93266`. Local rollback dry-run, roll-forward, backup/restore, scheduler and teardown verification passed. Remote staging preflight not executed; remote staging deployment not executed; application version remains `0.1.0-ms-016`.

MS-017B3 handoff notu: Staging host provisioning contract and operator handoff bundle generator/verifier prepared. Bundle output is external, secret-free and machine-verifiable; it does not generate real target/env/known_hosts, create a remote marker, contact SSH/network, transfer package/image, mutate Docker resources or deploy staging/production. Remote staging preflight remains not executed.

MS-017B approved target preflight notu: Target alias `habersoft-rss-staging-alias` icin read-only remote staging preflight 2026-06-22 UTC tarihinde iki kez passed. Strict SSH host identity, environment marker, Linux `linux/amd64`, Docker/Compose readiness, project `absent`, API port `available`, base-dir `existing-empty-approved`, filesystem `read-write`, loopback-only edge mode ve unchanged target inventory kanitlandi. Staging deployment, package/image transfer, rollback/roll-forward, production deployment ve artifact publication yapilmadi.

## Sabit Runtime ve Altyapi Surumleri

- Node.js application image: `node:24.17.0-bookworm-slim`
- Node.js exact patch: `24.17.0`
- NestJS: `11.1.27`
- Prisma CLI ve Client: `6.19.3`
- Redis client: `ioredis 5.11.1`
- BullMQ: `5.79.0`
- NestJS BullMQ integration: `@nestjs/bullmq 11.0.4`
- JOSE/JWT library: `jose 6.2.3`
- PostgreSQL image: `postgres:17.9-bookworm`
- Redis image: `redis:8.8.0-trixie`

## Yerel Dokumantasyon Kontrolu

Davranisi, calistirma komutunu, configuration anahtarini veya container topolojisini etkileyen her degisiklik ayni degisiklik dizisinde `.docs/` alanina yansitilir. Gercek secret, credential veya uretim ortam degeri dokumana yazilmaz.
