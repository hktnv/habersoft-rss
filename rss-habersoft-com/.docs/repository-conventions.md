# Repository Conventions

## Sorumluluk

Bu belge `main-service` repository'sinin cross-platform Git checkout, line-ending, POSIX artifact ve workspace mirror hijyen sozlesmesinin canonical sahibidir.

Bu belge local runtime setup sahibi degildir. Yerel container calistirma, `.env` placeholder'lari ve local test komutlari [local-development.md](local-development.md) dosyasinda kalir.

## Change Reason

Bu belge yalniz repository checkout policy, tracked POSIX artifact line ending'i, canonical guide mirror byte equality veya safe renormalize proseduru degistiginde guncellenir.

## Windows Checkout Model

Windows host'larda global `core.autocrlf=true`, Git index/blob icerigi ile working tree bytes arasinda otomatik donusum yapabilir. Bu davranis normal text dosyalari icin kabul edilebilir olsa da POSIX shell artifact'lari ve byte-identical mirror sozlesmeleri icin risklidir.

Repository-local `.gitattributes`, global Git config'in uzerinde bu repository'nin checkout sozlesmesini tanimlar. Kural sonradan eklenirse daha once staged veya committed dosya otomatik olarak LF blob'a donusmus sayilmaz; affected path'ler bilincli renormalize edilmelidir.

Current mandatory rules:

```gitattributes
.gitattributes text eol=lf
scripts/*.sh text eol=lf
PRODUCTION.md text eol=lf
```

Butun Markdown dosyalarini topluca LF'ye zorlamak bu repository'nin current policy'si degildir. Yeni mirrored tracked guide veya POSIX shell template eklenirse once explicit `.gitattributes` rule'u eklenir, sonra dosya stage edilir.

## POSIX Shell Artifacts

Tracked `.sh` dosyalari LF blob ve LF checkout gerektirir. CRLF ile checkout edilen shell script, Git Bash veya Linux production host uzerinde syntax error uretebilir. `scripts/production-operational-evidence-collector.sh` ve `scripts/production-checkout-pointer-collector.sh` bu nedenle hem Git blob hem working tree seviyesinde CR byte tasimamalidir.

Generated handoff collector da LF olmalidir. Handoff verifier ve repository hygiene gate, generated collector CRLF ise fail-closed davranir.

Required checks:

```powershell
git check-attr text eol -- scripts/production-operational-evidence-collector.sh scripts/production-checkout-pointer-collector.sh PRODUCTION.md .gitattributes
git ls-files --eol -- scripts/production-operational-evidence-collector.sh scripts/production-checkout-pointer-collector.sh PRODUCTION.md .gitattributes
node scripts/repository-hygiene-verify.mjs
bash -n scripts/production-operational-evidence-collector.sh
bash -n scripts/production-checkout-pointer-collector.sh
bash -n <external-handoff-dir>/collect-production-operational-evidence.sh
bash -n <external-ms-019d-handoff-dir>/collect-production-checkout-pointer-evidence.sh
```

Blob-level scan, `git show HEAD:<path>` bytes icinde `\r` bulunmadigini dogrular. Worktree-level scan ise checkout bytes icinde `\r` bulunmadigini dogrular. Gorsel olarak ayni metin, byte-identical veya LF-clean anlamina gelmez.

## Production Guide Mirror

Repository root `PRODUCTION.md` canonical tracked guide'dir. Workspace root mirror `..\PRODUCTION.md` turetilmis kopyadir ve canonical guide ile byte-identical kalmalidir.

Mirror update kurallari:

- canonical file degismediyse mirror sirf timestamp icin yeniden yazilmaz,
- mirror text decode/encode pipeline ile yazilmaz,
- PowerShell `Get-Content | Set-Content` kullanilmaz,
- repository sync helper yoksa byte-preserving copy kullanilir,
- Node `fs.copyFileSync` veya binary copy tercih edilir,
- canonical ve mirror SHA-256 ayri hesaplanir,
- byte equality exact kontrol edilir.

## Safe Renormalize Procedure

Line-ending duzeltmesi gerekirse:

1. Kullanici dirty worktree'sinde islem yapma.
2. Latest safe base'den dedicated clean worktree olustur.
3. Once `.gitattributes` rule'unu ekle veya duzelt.
4. Yalniz affected path'ler icin `git add --renormalize -- <explicit-paths>` calistir.
5. Staged diff'i exact incele.
6. Unexpected broad Markdown, source veya package churn varsa commit etme.
7. `git diff --cached --check`, `git ls-files --eol` ve blob scan calistir.
8. Fresh integration worktree'de checkout'u yeniden kanitla.
9. `reset --hard`, `git clean`, user changes overwrite veya blanket `git add --renormalize .` kullanma.
10. Shell content semantik olarak degismediyse line-ending-only diff'i acikca raporla.

Broad unreviewed renormalization yasaktir; cunku unrelated docs/source bytes degisebilir ve evidence review'u bulandirilir.

## Fresh Worktree Proof

Final proof, ayni branch'in fresh worktree checkout'unda tekrarlanir. Bu kanit, current worktree'nin gecici olarak LF-normalized olmasindan daha gucludur; `.gitattributes` kuralinin yeni checkout'ta etkili oldugunu gosterir.

Minimum fresh worktree proof:

- `git ls-files --eol` collector, `PRODUCTION.md` ve `.gitattributes` icin `i/lf`, `w/lf`, `attr/text eol=lf` gosterir,
- tracked collectors `bash -n` gecirir,
- generated handoff collector LF ve `bash -n` gecirir,
- canonical `PRODUCTION.md` ve workspace mirror SHA-256 degerleri aynidir.

## Automation Gate

`npm run repository:hygiene:verify`, repository-level hijyen sozlesmesini fail-closed dogrular:

- `.gitattributes` mandatory LF coverage,
- collector Git blob CRLF absence,
- collector working tree CRLF absence,
- generated handoff collector CRLF absence when handoff bundle exists,
- optional `bash -n` syntax check when Bash is available,
- canonical production guide and workspace mirror byte equality when mirror exists,
- no broad `*.md text eol=lf` rule.

`npm run test:production-evidence`, bu gate'i ve negatif fixture'larini da calistirir.
