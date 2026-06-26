# Production Edge Body-Limit Evidence

## Sorumluluk

Bu belge `main-service` icin MS-019E production edge request-body compatibility sozlesmesinin canonical repository-local sahibidir. Tek sorumlulugu `rss.habersoft.com` public HTTPS edge katmaninin application request-body sinirini kesmeden upstream auth boundary'ye iletip iletmedigini kanitlayan read-only operator handoff, accepted receipt ve verifier semantics'i aciklamaktir.

Bu belge edge evidence accepted sonucunun ve reusable verifier semantics'in repository-local sahibidir. MS-019E-R2 immutable returned bundle'i `production-edge-body-limit-receipt-v2.json` ile kabul etti.

## Application Body Contract

Runtime source otoritesi:

- `src/agent-entries/agent-entries.policy.ts`
- `src/bootstrap/api-entrypoint.ts`
- `test/bootstrap/bootstrap.spec.ts`
- `test/agent-entries/agent-entries.controller.spec.ts`

Canonical route:

```text
POST /agent/entries
Content-Type: application/json
```

Application request body limit:

```text
5 * 1024 * 1024 = 5242880 bytes
```

Byte unit binary MiB'dir. `POST /agent/entries` icin `content-length > 5242880` application on-request hook tarafindan `413 REQUEST_BODY_TOO_LARGE` ile reddedilir. Exact `5242880` byte body application body parser/auth boundary'ye gecmek uzere kabul edilir.

## Safe Probe Route

Probe route'u `POST /agent/entries` olarak sabittir. Route `AgentKeyAuthGuard` ile korunur ve yalniz `X-Agent-Key` kabul eder. MS-019E collector credential gondermez:

- no Agent credential,
- no tenant JWT,
- no cookies,
- no valid business DTO,
- no database write expectation.

Probe payload deterministic invalid DTO shape kullanir:

```json
{"probe":"aaaa..."}
```

Missing Agent credential source testlerinde payload validation ve business use-case oncesinde `401` dondurur; use-case `execute` cagrilmaz. Bu nedenle small ve exact-limit body'ler application auth boundary'ye ulastiginda expected status `401` olur.

## Probe Matrix

Collector en fazla alti sequential request yapar:

| Probe | Target | Bytes | Expected status |
|---|---|---:|---:|
| small | internal loopback | `1024` | `401` |
| small | public HTTPS | `1024` | `401` |
| exact limit | internal loopback | `5242880` | `401` |
| exact limit | public HTTPS | `5242880` | `401` |
| limit plus one | internal loopback | `5242881` | `413` |
| limit plus one | public HTTPS | `5242881` | `413` |

Internal target class:

```text
http://127.0.0.1:3200
```

Public target class:

```text
https://rss.habersoft.com
```

Core compatibility claim:

```text
public exact-limit status == internal exact-limit expected status
and public uploaded bytes == 5242880
```

Vendor configured exact edge limit remains `NOT_RECORDED` unless separately proven.

## Upper-Control Semantics

Small and exact-limit probes require full generated and uploaded bytes. Exact-limit full upload is the edge compatibility gate; a public exact-limit short upload or `413` remains a blocker.

Limit-plus-one probes are bounded upper controls. The generated body must still equal `5242881` bytes and the HTTP status must be `413`, but the server may reject the over-limit body before reading all bytes. In that case curl `size_upload` can be lower than requested and the verifier classifies the record as `EARLY_REJECTION_413`. A full upload followed by `413` is classified as `FULL_UPLOAD_REJECTED_413`.

Upper-control early rejection is accepted only when curl reports a valid HTTP response, the uploaded byte count is between `0` and requested bytes, TLS is not failed for public HTTPS, and no auth/cookie/retry/mutation flag is present. Missing status, transport failure, uploaded bytes greater than requested, wrong status, generated-byte mismatch or TLS failure remain blockers.

## HTTP Safety

Collector uses `curl -q` with normal TLS verification, fixed route/targets, `Content-Type: application/json`, empty `Expect:` header and `--data-binary @payload`. It does not use retries, concurrency, TLS bypass, DNS override, arbitrary URL/route/size flags, auth headers or cookies.

Payload files and response bodies are temporary only and are removed before output finalization. Raw headers, response body, request payload, private host details, config files, logs and secrets are not retained.

## Handoff And Receipt Flow

Local handoff generation:

```powershell
npm run production:edge-body-limit:handoff -- --output-dir <external-ms-019e-handoff-v1-dir>
npm run production:edge-body-limit:handoff:verify -- --handoff-dir <external-ms-019e-handoff-v1-dir>
npm run production:edge-body-limit:handoff:freeze -- --handoff-dir <external-ms-019e-handoff-v1-dir> --freeze-file <external-freeze-file> --fixture-result PASSED
node scripts/production-edge-body-limit-evidence.mjs handoff:freeze:verify --handoff-dir <external-ms-019e-handoff-v1-dir> --freeze-file <external-freeze-file>
```

Generated handoff-v1 inventory:

```text
README.md
collect-production-edge-body-limit-evidence.sh
edge-body-limit-contract.json
manifest.json
checksums.sha256
```

Operator returned evidence inventory must be exactly:

```text
checksums.sha256
collector-metadata.txt
evidence-records.tsv
```

Future receipt creation and verification:

```powershell
npm run production:edge-body-limit:authority:create -- --evidence-dir <returned-dir> --authority-file <external-authority> --handoff-dir <external-ms-019e-handoff-v1-dir> --freeze-file <external-freeze-file>
npm run production:edge-body-limit:authority:verify -- --evidence-dir <returned-dir> --authority-file <external-authority> --handoff-dir <external-ms-019e-handoff-v1-dir> --freeze-file <external-freeze-file>
npm run production:edge-body-limit:receipt:create -- --evidence-dir <returned-dir> --authority-file <external-authority> --handoff-dir <external-ms-019e-handoff-v1-dir> --freeze-file <external-freeze-file> --output-file <external-receipt>
npm run production:edge-body-limit:receipt:verify -- --receipt-file <external-receipt>
npm run production:edge-body-limit:receipt:verify -- --receipt-file <external-receipt> --require-edge-body-limit-compatibility
```

Strict verification accepts only `SUCCESS`. It rejects edge-too-low, internal application baseline mismatch, public edge unavailable, TLS failure, invalid upper-control response, checksum mismatch, unsafe flags, missing probes, exact-limit byte mismatch or retained payload/response evidence.

Accepted MS-019E-R2 receipt:

```text
receipt: production-edge-body-limit-receipt-v2.json
sha256: fabad4a60f1f284379e1cd903b582b53bfd1fcbf93af32e79a94a1efa6377244
returned authority sha256: 43fa65c0e9aadf860fc40179b4e64bccf4b3f18eeffedb1e324e0fcef3847622
returned tree digest: 2c35c4861e13e53bac2ab704d30217cd0c982ca41b4196d19a98fb9967f8cc0e
historical blocked receipt sha256: 9bd74b14d50525d1f408deebbb19d8912e71b4d21fe7f23b41a602ba0f966965
semantic correction: VERIFIER_BUG_EARLY_REJECTION_SEMANTICS
```

## Current State

MS-019E accepted state:

```text
handoff tooling: prepared
returned evidence: accepted
production contact by Codex: false
edge body-limit evidence accepted: true
public edge compatibility: PUBLIC_EDGE_ACCEPTS_CANONICAL_APPLICATION_BODY_LIMIT
exact vendor configured limit: NOT_RECORDED
```

Open extended operational residuals remain:

- historical previous pointer: `NOT_RECORDED`
- bounded operational-smoke/error-signal: `SUCCESS_GOVERNANCE_ACCEPTED`
- long-term stability: `NOT_APPLICABLE_BY_GOVERNANCE_DECISION`

MS-019E touches only the edge body-limit evidence preparation path. It does not reopen previous pointer or MS-019F-R5 operational-smoke/error-signal governance acceptance.

## Tests

Focused gate:

```powershell
npm run test:production-edge-body-limit-evidence
```

The test covers source contract alignment, exact payload sizes, generated handoff verification/freeze, local curl early-rejection fixture servers, fake-curl fixture collector execution, strict positive receipt, edge-too-low negative receipt, TLS failure, connection close, exact short upload, upper-control no-status/transport/bad-status/over-upload failures, unsafe flags, public/internal control failures, status mismatch, output inventory and static collector safety.
