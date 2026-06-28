# habersoft-rss Production Guide

This root guide owns product-level production boundaries for the `habersoft-rss` repository. It does not replace the project-owned guides:

- Backend: [`rss-habersoft-com/PRODUCTION.md`](rss-habersoft-com/PRODUCTION.md)
- Admin UI: [`rss-admin-ui/PRODUCTION.md`](rss-admin-ui/PRODUCTION.md)

Topology classification: `POLYREPO_STYLE_SINGLE_GIT_MONOREPO`.

Codex workspace hygiene is governed by [`CODEX_WORKSPACE_POLICY.md`](CODEX_WORKSPACE_POLICY.md). MS-020E requires new Codex temporary workspaces, clones, worktrees, test folders, build outputs, package outputs, and task caches to live under `E:\Codex\rss-habersoft-com\workplace\`. This is not a production path migration and does not move production checkout ownership.

## Current Status

| Project | Production status | Deployment status |
|---|---|---|
| `rss-habersoft-com` | `MVP - Production Active` | Existing backend runtime remains untouched |
| `rss-admin-ui` | `MS-023A-R2_OPERATOR_MANAGED_PRODUCTION_PACKAGE_READY - NOT_DEPLOYED` | Not deployed |

MS-020A performed repository topology migration and local workspace cutover only. MS-020B added a local/tested read-only admin status dashboard contract and frontend slice. MS-020C adds a local/tested same-origin health transport and local full-stack rehearsal for that dashboard. MS-020D packages the production activation readiness contract, operator authority template, future evidence checklist, and local readiness verifier. MS-021A adds a frontend-only fail-closed protected admin/business shell foundation. MS-021B adds only a same-origin admin session sentinel and fail-closed auth-status client. MS-022A adds a disabled-by-default local admin auth/session foundation and exact same-origin auth proxy activation, while `rss-admin-ui` remains not deployed. MS-022B adds secretless admin auth provisioning helpers, local production-mode RC acceptance, and operator handoff docs for a future activation milestone. MS-023A-R2 adds the operator-managed production configuration/proxy package, local verifier, and runbook guidance while preserving the `NOT_DEPLOYED` claim boundary. These milestones do not SSH to production, run production `git pull`, restart containers, rebuild a production image, publish an image, create a Git tag, create a GitHub Release, create a PR, capture rollback baseline for the operator, or mutate production environment files.

Explicit path migration status:

`PRODUCTION_PATH_MIGRATION_NOT_PERFORMED_IN_MS-020A`

## Deployment Order Boundary

Future production deployment must be authorized as a separate milestone. The operator should deploy in this order only after fresh preflight and evidence gates:

1. Update the server checkout model for the root repository.
2. Enter the backend project root for backend deployment.
3. Re-run backend production preflight, backup, and evidence checks required by the backend guide.
4. Deploy the admin UI separately only after an approved frontend deployment milestone.

Future target checkout layout, not current production state:

```text
/opt/habersoft-rss/rss-habersoft-com
/opt/habersoft-rss/rss-admin-ui
```

Do not claim the running host has already migrated to that layout until the operator performs and verifies it.

## Environment Ownership

Backend production environment variables, image identity, database/Redis/JWKS contracts, backup/restore, rollout, rollback, and evidence receipts are owned by [`rss-habersoft-com/PRODUCTION.md`](rss-habersoft-com/PRODUCTION.md).

Admin UI runtime config, read-only health dashboard behavior, same-origin health transport, protected admin shell boundary, activation readiness classification, secretless activation package, future authority template, static image delivery, reverse-proxy expectations, and frontend rollback are owned by [`rss-admin-ui/PRODUCTION.md`](rss-admin-ui/PRODUCTION.md).

MS-023A-R2 responsibility split:

- rollback baseline is operator-managed and must be captured by the operator before any server mutation;
- server deployment/configuration is operator-managed, including server checkout, Docker/Compose, env placement, DNS/TLS/OpenLiteSpeed/firewall, and service restart/reload decisions;
- Codex-owned repository work is limited to secretless templates, same-origin proxy configuration, local synthetic validation, and runbook guidance;
- MS-023A-R2 does not prove production activation and does not change the backend's accepted production evidence series.

Root Compose is for local orchestration and CI config validation. It is not a production deployment file.

The E: Codex workplace root is for Codex-created temporary task artifacts only. It does not authorize cleanup or relocation of production evidence, `.md`, `operator-state`, historical Desktop worktrees, legacy tombstone paths, or user data.

## Docker Naming

Local root Compose project name: `habersoft-rss-local`.

Backend production Compose project name remains backend-owned and unchanged. Admin UI production image naming is frontend-owned and remains template-only in MS-022A.

## Version Boundary

| Project | Version |
|---|---|
| Backend `main-service` | `0.1.0-ms-017` |
| Frontend `rss-admin-ui` | `0.1.0` |

There is no shared product version bump, backend package version bump, Git tag, GitHub Release, registry publication, or production image publication in MS-022A or MS-022B. The backend package remains `0.1.0-ms-017` because the added admin auth routes are disabled by default unless explicitly configured, locally rehearsed only, and not production-activated by these milestones.

## Evidence Ownership

Accepted backend evidence remains under backend docs and ignored external `operator-state/`. The historical MS-018C through MS-019F evidence series is preserved and not reopened. MS-019F long-term stability remains `NOT_APPLICABLE_BY_GOVERNANCE_DECISION`.

## No-Secret Handling

Do not commit production secrets, DB passwords, Agent keys, JWTs, private keys, raw production evidence bodies, or private host credentials. Runtime env files remain untracked. Local examples must use placeholders or non-secret synthetic values.

## Rollback Ownership

Backend rollback is controlled by the backend production guide and must preserve immutable image identity and operator evidence. Admin UI rollback is controlled by the frontend production guide and is not active until the UI is deployed in a later milestone. MS-023A-R2 documents the rollback-baseline requirement but does not capture or infer a baseline.
