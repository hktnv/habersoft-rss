# Service Handbook

## Bu el kitabi nedir?

Bu el kitabi, `main-service` projesine bir sure ara verdikten sonra tekrar bakan gelistirici veya entegrator icin sade bir baslangic noktasidir. Ayrintili tasarim kararlarini tekrar yazmaz; hangi servisin ne yaptigini, sinirlarin nerede oldugunu ve hangi belgeye gidilecegini anlatir.

## Uc ana aktor

`main-service`: central authority.

`Agent`: external-world adapter.

`Tenant client`: authenticated consumer.

## Mimari felsefe

`main-service`, feed katalogu, tenant abonelikleri, entry gorunurlugu, Agent'tan gelen sonuclar ve cleanup sorumlulugunun merkezi kaynagidir. Agent dis dunyadan RSS verisi getirir ve normalize edilmis sonucu server'a bildirir. Tenant client yalniz kendi kimligiyle yetkilendirilmis public API'yi kullanir.

Bu ayrim, veritabanina kimin yazabilecegini, kimliklerin nereden geldigini ve operasyonel rollback/backup davranisini sade tutar.

## Okuma sirasi

1. [main-servis-kilavuzu.md](main-servis-kilavuzu.md)
2. [agent-servis-kilavuzu.md](agent-servis-kilavuzu.md)
3. [tenant-servis-kilavuzu.md](tenant-servis-kilavuzu.md)

## Hangi belge hangi soruyu cevaplar?

| Belge | Cevapladigi soru |
|---|---|
| [main-servis-kilavuzu.md](main-servis-kilavuzu.md) | Runtime rolleri, veri iliskileri, port modeli, backup ve rollback nasil dusunulmeli? |
| [agent-servis-kilavuzu.md](agent-servis-kilavuzu.md) | Agent main-service'e nasil konusur, hangi state'i tutmaz, hangi endpoint'leri kullanir? |
| [tenant-servis-kilavuzu.md](tenant-servis-kilavuzu.md) | Tenant kimligi, izolasyon, JWT/JWKS ve public API kullanimi nasil calisir? |

## Ayrintili teknik belgeler

Ayrinti gerektiginde ana envanterden devam et: [../README.md](../README.md).

En cok bakilan detaylar:

- [../../PRODUCTION.md](../../PRODUCTION.md)
- [../production-deployment.md](../production-deployment.md)
- [../release-packaging.md](../release-packaging.md)
- [../backup-and-restore.md](../backup-and-restore.md)
- [../tenant-authentication.md](../tenant-authentication.md)
- [../agent-authentication.md](../agent-authentication.md)
- [../background-job-runner.md](../background-job-runner.md)

## Bu el kitabinin kapsam disi alanlari

Bu el kitabi secret, host/IP, SSH, DNS provider, TLS private key, production receipt, raw backup veya deploy hedefi bilgisi tasimaz. Agent uygulamasinin kendi runtime implementasyonunu veya bagimsiz Tenant uygulamasinin production hazirligini tamamlanmis gibi anlatmaz.

Production operator akisi Git-only'dir: source tree dogrudan sunucuya upload edilmez; operator `PRODUCTION.md` uzerinden Git pull, server-local Docker build ve Compose akisini uygular.

Current production activation status icin canonical ozet [../production-acceptance.md](../production-acceptance.md) dosyasindadir. Bu el kitabi endpoint contract veya evidence detaylarini tekrar etmez.
