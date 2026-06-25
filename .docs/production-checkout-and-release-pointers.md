# Production Checkout And Release Pointers

## Sorumluluk

Bu belge `main-service` production Git checkout hygiene, current runtime image pointer identity, previous rollback pointer evidence ve future release-pointer rotation sozlesmesinin canonical repository-local sahibidir.

MS-019D hazirlik/handoff sonucu `OPERATOR_ACTION_REQUIRED` idi. MS-019D-R1 returned evidence intake, current production checkout hygiene ve current runtime pointer evidence'i `PARTIAL_ACCEPTED` olarak kabul etti. Historical previous pointer `NOT_RECORDED` kalir; forward rollback baseline state yalniz sonraki deployment icin current pointer'dan external olarak kuruldu. Codex production sunucusuna baglanmadi ve production command calistirmadi.

Out of scope:

- edge body-limit evidence,
- MS-019F-R1 bounded operational-smoke/error-signal evidence,
- deployment, migration, backup, restore veya release publication.

## Current Evidence Boundary

MS-019B receipt current production runtime image identity alanlarini kaydetti, fakat server checkout clean flag historical olarak false/dirty idi. MS-019D-R1 fresh returned checkout/pointer bundle'i local olarak intake etti ve current checkout hygiene evidence'i `PASSED` durumuna getirdi. Previous production pointer `NOT_RECORDED` kalir.

MS-019C backup/restore baseline `PRODUCTION_BACKUP_RESTORE_VERIFIED` durumundadir. Bu durum checkout hygiene veya previous pointer evidence yerine gecmez.

Returned evidence external `operator-state/ms-019d/production-checkout-pointer-returned-v1` altinda tutulur ve Git'e commit edilmez. Receipt, returned authority ve pointer state de external operator-state artifact'idir.

## MS-019D-R1 Accepted Receipt

Returned bundle intake result:

- Outcome: `PARTIAL_ACCEPTED`
- Returned authority SHA-256: `44be2ff5d3d666ba359ac0af9c206c593ab0a6e2cc0a5bc630f5079c9c4ad8a9`
- Returned tree digest: `39589acae16aeeee649caa44df82dff5483e59537a2a2b05e7adcaf3f60f4bc0`
- Receipt SHA-256: `e823ec819d471c8bb3c5052e6def3a6830731058952971675bdd4ae4d1f6c63a`
- Collection UTC: `2026-06-25T13:52:49Z`
- Rollback baseline state SHA-256: `ce6908a1196451c5737086943c4b9a9ad116ccc7d45c953fab6b2eb17936681c`

Verified safe projections:

| Check | Result | Boundary |
|---|---|---|
| Checkout hygiene | `PASSED` | Branch `main`, checkout commit `1745fcb250208ffa22aac5aac745cda49dcfd865`, canonical remote normalized to `https://github.com/hktnv/habersoft-rss`, tracked and unknown untracked counts zero. |
| Checkout classification | `ALLOWLISTED_EXTERNAL_STATE_IGNORED` | Required external state ignore policy was present; operator-state was ignored rather than committed. |
| Current runtime image chain | `PASSED` | Runtime env, API, worker and inspected image all matched `sha256:441daac4dc406059fc640df645366f491d34f4cd5fa868852dc24a32ad78865b`. |
| Current runtime revision | `PASSED` | OCI revision `186a30d4c8c09c97bcd37c1f4c787e5c5e49f397` is valid canonical history and ancestor of verified `origin/main`. |
| Checkout/runtime equality | `false` | Accepted because runtime revision is a verified ancestor; equality with checkout HEAD is recorded, not required. |
| Historical previous pointer | `NOT_RECORDED` | No strict previous pointer file was supplied; no staging, Docker age/order or Git-parent inference was used. |
| Forward rollback baseline | `ESTABLISHED_FROM_CURRENT_POINTER` | External pointer state records the current verified pointer as the baseline to rotate before the next runtime mutation. |

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

Current pointer passes only when API, worker and runtime image IDs match; OCI revision is a 40-hex commit in canonical history and is an ancestor of the verified current `origin/main`; OCI source normalizes to the canonical GitHub remote. The checkout/runtime equality boolean is recorded truthfully, but equality is not required because a clean checkout can be ahead of the running immutable image.

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

Future deployments should rotate an external nonsecret pointer state before mutating the runtime and again after a successful release:

```text
operator-state/ms-019d/production-release-pointer-state.json
```

MS-019D-R1 created and verified this external state from the current verified pointer because no historical previous pointer was supplied. The state is forward-looking and must not be described as a reconstructed historical previous release.

Schema intent:

- current release commit and image ID,
- previous release commit and image ID,
- canonical remote,
- Compose context paths,
- rotation timestamp,
- nonsecret receipt/checksum references,
- production mutation flag set by the operator procedure, not by Codex.

This file is external operator state. Future tooling must update it only as part of an operator-authorized production release procedure, not during repository tests or handoff generation.

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

After the operator returns evidence, local intake flow is:

```powershell
npm run production:checkout-pointer:authority:create -- --evidence-dir <returned-dir> --authority-file <authority-file>
npm run production:checkout-pointer:authority:verify -- --authority-file <authority-file>
npm run production:checkout-pointer:receipt:create -- --evidence-dir <returned-dir> --authority-file <authority-file> --pointer-state-file <pointer-state-file> --output-file <receipt-file>
npm run production:checkout-pointer:receipt:verify -- --receipt-file <receipt-file> --require-checkout-hygiene
npm run production:checkout-pointer:pointer-state:verify -- --state-file <pointer-state-file> --receipt-file <receipt-file>
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
- operational-smoke probing,
- error-signal/log analysis,
- Git tag,
- GitHub Release,
- artifact publication.

Generated handoff, returned evidence and receipt files are external artifacts. Raw dumps, secret values, `.env.production` content, Docker full inspect JSON, raw logs and unknown untracked path names are not persisted in repository artifacts.

## Residual Evidence

After MS-019D-R1 lands, expected status is:

```text
checkout hygiene current evidence: PASSED
current pointer fresh evidence: PASSED
previous pointer: NOT_RECORDED until returned strict pointer evidence exists
rollback baseline for next deployment: ESTABLISHED_FROM_CURRENT_POINTER
edge body-limit: PASSED by MS-019E-R2 receipt
bounded operational-smoke/error-signal: PENDING_OPERATOR_RUN by MS-019F-R1
long-term stability: NOT_APPLICABLE_BY_GOVERNANCE_DECISION
```

This partial acceptance updates `.docs/production-acceptance.md` with only the safe checkout/current pointer projections. Full operational acceptance remains partial because historical previous pointer is still absent and bounded operational-smoke/error-signal evidence is still pending operator run.
