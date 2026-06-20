# Agent Authentication

## Kapsam

MS-008, Agent API controller'lari icin route-level `X-Agent-Key` authentication altyapisini ekler. MS-010 itibariyla production consumer route'lari `POST /agent/heartbeat` ve `GET /agent/feeds/due` route'laridir.

Tenant JWT authentication ayri kalir. `X-Agent-Key` tenant route'larini acmaz; tenant `Authorization: Bearer` token'i agent route'larini acmaz.

## Configuration

`AGENT_KEY` yalniz API rolunde zorunludur. Worker, migrate ve local JWKS fixture container'lari bu degiskeni almaz ve beklemez.

Local placeholder:

```text
AGENT_KEY=replace_with_local_only_agent_key_at_least_32_bytes
```

API bootstrap sirasinda key eksik, bos, whitespace-only, leading/trailing whitespace iceren, 32 UTF-8 byte altinda olan veya ASCII control character iceren degerleri reddeder. Production ortaminda local placeholder veya `replace_with` / `local_only` iceren degerler reddedilir.

Secret degeri config error mesajina, log'a, health response'una veya public HTTP response'a yazilmaz.

## Header Contract

- Public header: `X-Agent-Key`.
- Header name HTTP kurali geregi case-insensitive ele alinir.
- Header value opaque ve case-sensitive kabul edilir.
- Exactly one header kabul edilir.
- Missing, malformed, duplicate veya wrong key tek tip safe `401` dondurur.
- Query, body, path, `Authorization` veya alias header credential kaynagi degildir.

## Verification

API provider construction sirasinda expected `AGENT_KEY` degerini UTF-8 SHA-256 digest'e cevirir. Request candidate degeri request-local SHA-256 digest'e cevrilir ve Node `crypto.timingSafeEqual` ile fixed-length digest uzerinden karsilastirilir.

Raw string equality, prefix/suffix, locale comparison, custom XOR veya timing benchmark tabanli test kullanilmaz.

## Principal

Basarili dogrulama request uzerine immutable `AgentPrincipal` ekler:

```text
agentId=default
```

Principal raw key, digest veya fingerprint tasimaz.

## Runtime Boundary

`AgentAuthModule` API module graph'ina provider olarak girer, global `APP_GUARD` kullanmaz ve controller expose etmez. Guard Agent route'larina route-level uygulanmak icin export edilir; MS-010'da `POST /agent/heartbeat` ve `GET /agent/feeds/due` bu guard'i kullanir.

Agent auth DB, Redis, JWKS, network, session, cache, JWT, OAuth, Passport, scope, role, multi-key, dual-key veya hot reload kullanmaz.

## Test ve Dogrulama

Agent auth testleri:

```powershell
npm run test:agent-auth
```

Bu test seti config, header parser, verifier, principal, test-only protected controller, health no-key davranisi, tenant/agent auth ayrimi, due-feed route authentication ayrimi ve worker boundary kontrollerini kapsar.
