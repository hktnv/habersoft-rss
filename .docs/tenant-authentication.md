# Tenant Authentication

## Kapsam

MS-003, API process'i icin tenant JWT/JWKS dogrulama altyapisini ekler. MS-005 itibariyla mevcut Tenant API feed rotalarinda bu guard rate-limit guard'indan once calisir. Bu dokuman uygulanmis repository gercegini kaydeder; merkezi master veya DEV dokumanlarinin yerine gecmez.

Bu authentication katmani Agent API endpoint'i, token minting, auth-service introspection, scheduler veya cleanup davranisi eklemez.

## JWT Dogrulama Kurallari

- Token tipi: `Authorization: Bearer <jwt>`.
- Algoritma: yalnizca `RS256`.
- Issuer: `https://auth.habersoft.com`.
- Audience: `aud` array olmali ve `rss.habersoft.com` degerini icermelidir.
- Scope: `scope` claim'i icinde exact `services:access` bulunmalidir.
- Clock tolerance: 30 saniye.
- `sub`: bos olmayan canonical tenant/site client id.
- `client_id`: bos olmayan string olmali ve `sub` ile birebir ayni olmalidir.

Dogrulama local yapilir. API, request basina auth-service introspection veya remote karar cagrisi yapmaz.

## Tenant Principal

Basarili dogrulama sonunda request uzerine immutable `TenantPrincipal` eklenir:

- `siteClientId`: token `sub` degeri.
- `subject`: token `sub` degeri.
- `scopes`: runtime'da mutator metodu expose etmeyen readonly scope set'i.
- `tokenId`: varsa token `jti` degeri.

Request body, query veya path degerleri tenant kimligini override edemez. Gelecek Tenant API controller'lari bu principal'i kaynak kabul etmelidir.

## JWKS Lifecycle

API process'i baslarken JWKS'i ilk kez yuklemeyi dener ve sonucu readiness'e yansitir. Basarili cache varsa cache atomik olarak kullanilir.

- Periyodik refresh araligi: 5 dakika.
- Kid miss durumunda tekil fallback refresh calisir.
- Eszamanli refresh denemeleri single-flight davranir.
- Gecersiz JWKS eski basarili cache'i silmez.
- Worker process'i TenantAuthModule veya JWKS lifecycle baslatmaz.

JWKS fetch altyapisi bounded HTTP timeout ve response size limiti kullanir. Fixture dahil private key hicbir zaman cache veya log'a yazilmaz.

## HTTP Semantigi

- Eksik, coklu veya malformed `Authorization` header: `401`.
- Gecersiz header, alg, kid, imza veya zorunlu claim: `401`.
- Gecerli token fakat `services:access` scope yok: `403`.
- JWKS altyapisi token hakkinda karar veremeyecek durumdaysa: `503`.

Tenant auth hatalari public agent hata kodu katalogunu kullanmaz ve response body icinde token, secret, JWKS URL credential'i veya low-level altyapi detayi dondurmez.

Tenant auth hatalari 401/403/503 olarak rate-limit guard'indan once sonlanir ve tenant rate-limit kotasi tuketmez.

## Health

`/health/live` dependency-independent kalir. PostgreSQL, Redis veya JWKS durumuna bakmadan API process'inin HTTP cevap verebildigini bildirir.

`/health/ready`, PostgreSQL, Redis ve tenant auth JWKS cache hazir oldugunda `ready` doner. JWKS hic basariyla yuklenmemisse readiness `not_ready` olur.

## Local Fixture

Compose default topolojisinde `tenant-auth-jwks-fixture` servisi kullanilir. Bu servis:

- Aynı application image icinden `npm run start:jwks-fixture` ile baslar.
- Host portu yayimlamaz.
- `/.well-known/jwks.json` public JWKS endpoint'i sunar.
- `/health/live` ile Compose healthcheck'e cevap verir.
- Private key'i persist etmez.

Production config, fixture hostname'i veya `http://` JWKS URL'ini reddeder.

## Test ve Dogrulama

Auth testleri:

```powershell
npm run test:auth
```

Tum uygulama testleri:

```powershell
npm test
npm run test:all
```

Live auth-service token contract testi bu milestone'un default smoke set'ine dahil degildir. Operator tarafindan gercek token saglanmadikca "passed" olarak raporlanmaz.
