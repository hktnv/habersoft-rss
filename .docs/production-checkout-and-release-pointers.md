# Production Checkout And Release Pointers

## Sorumluluk

Bu belge `main-service` production Git checkout hygiene, current runtime image pointer identity, previous rollback pointer evidence ve future release-pointer rotation sozlesmesinin canonical repository-local sahibidir.

Bu milestone'un normal sonucu `OPERATOR_ACTION_REQUIRED` durumudur. Bu belge ve tooling current production checkout'un temiz oldugunu, previous pointer'in kanitlandigini veya yeni bir production acceptance pass olustugunu iddia etmez. Codex production sunucusuna baglanmaz ve real checkout/pointer evidence toplamaz.

Out of scope:

- edge body-limit evidence,
- long-term stability evidence,
- error-burst evidence,
- deployment, migration, backup, restore veya release publication.

## Current Evidence Boundary

MS-019B receipt current production runtime image identity alanlarini kaydetti, fakat server checkout clean flag historical olarak false/dirty idi ve fresh current checkout hygiene evidence bu belgeyle henuz toplanmadi. Previous production pointer `NOT_RECORDED` kalir.

MS-019C backup/restore baseline `PRODUCTION_BACKUP_RESTORE_VERIFIED` durumundadir. Bu durum checkout hygiene veya previous pointer evidence yerine gecmez.

Bu milestone repository'ye yalniz operator-run collector, local verifier/generator ve dokumantasyon sozlesmesi ekler. Actual returned evidence daha sonra external `operator-state/ms-019d/production-checkout-pointer-returned-v1` altinda operator tarafindan saglanir.

## Repository Hygiene Contract

Production operator-state ve runtime-local artifacts Git disi kalir. Current `.gitignore` contract:

```gitignore
.env.production
deploy/runtime-image.env
operator-state/
```

MS-019D audit bu uc rule'un mevcut oldugunu dogruladi; bu nedenle `.gitignore` degisikligi yapilmadi. Future checkout hygiene evidence icin:

- tracked source/doc/config dosyalarinda staged veya unstaged degisiklik olmamalidir,
- unmerged, rebase, merge, cherry-pick veya revert state olmamalidir,
- unknown untracked path olmamalidir,
- `operator-state/` Git status'ta untracked olarak gorunmemelidir; ignored olmalidir,
- source path'lerini saklayan overbroad ignore rule'u olmamalidir.

`operator-state/` ignored oldugu icin external evidence bundle'lar Git status'u kirletmez. Eger operator-state Git status'ta untracked gorunurse bu clean checkout pass degildir; ignore policy veya path yerlesimi duzeltilmelidir.

## Checkout Classification

Collector closed vocabulary kullanir:

| Classification | Meaning |
|---|---|
| `CLEAN` | No tracked/unknown dirtiness; no required ignore gap detected. |
| `ALLOWLISTED_EXTERNAL_STATE_IGNORED` | Checkout clean and required external state paths are ignored. |
| `ALLOWLISTED_EXTERNAL_STATE_UNTRACKED` | External state path appears untracked; strict hygiene fails. |
| `UNTRACKED_UNKNOWN` | Unknown untracked path exists; raw path is not persisted, only SHA-256 hash is recorded. |
| `TRACKED_INDEX_MODIFIED` | Staged tracked change exists. |
| `TRACKED_WORKTREE_MODIFIED` | Unstaged tracked change exists. |
| `TRACKED_DELETED` | Tracked deletion exists. |
| `UNMERGED_CONFLICTS` | Conflict/unmerged status exists. |
| `GIT_OPERATION_IN_PROGRESS` | Merge/rebase/cherry-pick/revert marker exists. |
| `DETACHED_HEAD` | Checkout is detached. |
| `WRONG_BRANCH` | Checkout is not `main`. |

Strict checkout hygiene accepts only `CLEAN` or `ALLOWLISTED_EXTERNAL_STATE_IGNORED` with zero tracked/unknown counts, required ignore policy present, no overbroad source ignore, canonical remote, branch `main`, and `HEAD == origin/main`.

## Current Pointer Contract

Current runtime pointer evidence must bind these values together:

- canonical repository remote `https://github.com/hktnv/habersoft-rss`,
- branch `main`,
- `HEAD` and local `refs/remotes/origin/main`,
- `deploy/runtime-image.env` exact `MAIN_SERVICE_IMAGE`,
- API running container image ID,
- worker running container image ID,
- inspected image ID,
- OCI `org.opencontainers.image.revision`,
- OCI `org.opencontainers.image.source`.

Current pointer passes only when API, worker and runtime image IDs match; OCI revision is a 40-hex commit in canonical history and equals the checkout `HEAD`; OCI source normalizes to the canonical GitHub remote.

Staging source/image identity, local Codex safe base, package hash, docs commit, master documentation hash or recency inference are not production current pointer evidence.

## Previous Pointer Contract

Previous pointer evidence is optional at collection time. If absent, receipt status is:

```text
PREVIOUS_POINTER_NOT_RECORDED
```

This is not a checkout hygiene failure, but it prevents complete previous-pointer acceptance.

If a previous pointer is available, the operator passes it explicitly:

```sh
--previous-pointer-file /path/to/previous-main-service-release.env
```

The file is never sourced and must contain only:

```text
PREVIOUS_COMMIT=<40-hex-commit>
PREVIOUS_IMAGE_ID=sha256:<64-hex-image-id>
```

Optional version marker:

```text
POINTER_CONTRACT_VERSION=production-release-pointer-state-v1
```

Unknown keys, duplicate keys, shell expansion, quotes requiring evaluation, command substitution, whitespace ambiguity, secret-looking fields or absolute path output are invalid. Previous pointer passes only if:

- previous commit is a 40-hex commit in canonical history,
- previous image ID is a local `sha256:<64-hex>` Docker image ID,
- previous image OCI revision equals previous commit,
- previous image OCI source normalizes to the canonical remote,
- previous image differs from the current runtime image,
- previous pointer is not a staging substitute,
- rollback remains compatible with current migration/data contract.

No recency inference is allowed.

## Future Pointer Rotation State

Future deployments should rotate an external nonsecret pointer state after a successful release:

```text
operator-state/ms-019d/production-release-pointer-state.json
```

Prepared schema intent:

- current release commit and image ID,
- previous release commit and image ID,
- canonical remote,
- Compose context paths,
- rotation timestamp,
- nonsecret receipt/checksum references,
- production mutation flag set by the operator procedure, not by Codex.

This file is external operator state and is not created by MS-019D. Future tooling must update it only as part of an operator-authorized production release procedure, not during repository tests or handoff generation.

## Collector

Tracked collector source:

```text
scripts/production-checkout-pointer-collector.sh
```

Generated handoff collector:

```text
collect-production-checkout-pointer-evidence.sh
```

Required operator inputs:

```sh
--repository-dir <production-repository-root>
--compose-file deploy/production/compose.yaml
--shared-env .env.production
--runtime-image-env deploy/runtime-image.env
--output-dir <new-empty-output-dir>
```

Optional:

```sh
--previous-pointer-file <external-file>
```

Returned inventory is exactly:

```text
collector-metadata.txt
evidence-records.tsv
checksums.sha256
```

Collector dependencies are Bash, Git, Docker, Docker Compose v2 and a SHA-256 utility. It does not require production Node or npm. It uses read-only Git/Docker/Compose commands, does not run HTTP probes, does not dump env/logs/secrets, does not build/pull/push images, does not run migrations, and does not mutate Compose services.

## Handoff And Local Verification

Local handoff generation:

```powershell
npm run production:checkout-pointer:handoff
```

Local handoff verification:

```powershell
npm run production:checkout-pointer:handoff:verify
```

External default handoff path:

```text
../operator-state/ms-019d/production-checkout-pointer-handoff-v1
```

Handoff-v1 inventory is exactly:

```text
README.md
collect-production-checkout-pointer-evidence.sh
checkout-pointer-contract.json
manifest.json
checksums.sha256
```

After the operator returns evidence, local receipt flow is:

```powershell
npm run production:checkout-pointer:receipt:create -- --evidence-dir <returned-dir> --output-file <receipt-file>
npm run production:checkout-pointer:receipt:verify -- --receipt-file <receipt-file> --require-checkout-hygiene
npm run production:checkout-pointer:receipt:verify -- --receipt-file <receipt-file> --require-checkout-hygiene --require-complete-previous-pointer
```

`--require-checkout-hygiene` fails unless the production checkout is strictly clean by this contract. `--require-complete-previous-pointer` additionally fails when previous pointer is `PREVIOUS_POINTER_NOT_RECORDED`.

## Safety Flags

MS-019D tooling must keep these flags false:

- production SSH/contact by Codex,
- production deploy/mutation,
- migration execution,
- backup/restore execution,
- edge body-limit probing,
- long-term stability probing,
- error-burst/log analysis,
- Git tag,
- GitHub Release,
- artifact publication.

Generated handoff, returned evidence and receipt files are external artifacts. Raw dumps, secret values, `.env.production` content, Docker full inspect JSON, raw logs and unknown untracked path names are not persisted in repository artifacts.

## Residual Evidence

After this repository milestone lands, expected status remains:

```text
checkout hygiene current evidence: OPERATOR_ACTION_REQUIRED
current pointer fresh evidence: OPERATOR_ACTION_REQUIRED
previous pointer: NOT_RECORDED until returned strict pointer evidence exists
edge body-limit: NOT_RECORDED
long-term stability: NOT_RECORDED
error-burst: NOT_RECORDED
```

This milestone does not update `.docs/production-acceptance.md` with a new pass.
