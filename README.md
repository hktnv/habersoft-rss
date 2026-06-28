# habersoft-rss

`habersoft-rss` is the single Git repository for the RSS product family. It uses the `POLYREPO_STYLE_SINGLE_GIT_MONOREPO` topology: one canonical remote, two first-class project roots, and root-owned orchestration/docs.

## Projects

| Project | Role | Status |
|---|---|---|
| [`rss-habersoft-com`](rss-habersoft-com/README.md) | Backend API, worker, production evidence owner | `MVP - Production Active` |
| [`rss-admin-ui`](rss-admin-ui/README.md) | Read-only admin status dashboard | `READ_ONLY_STATUS_DASHBOARD_SAME_ORIGIN_REHEARSED - NOT_DEPLOYED` |

The backend keeps its independent `package.json`, lockfile, Dockerfile, docs, production guide, evidence tooling, and release contract. The admin UI has its own manifest, lockfile, Dockerfile, docs, tests, and production delivery contract. The repository root owns cross-project navigation, local full-stack Compose, CI coordination, and topology verification.

## Prerequisites

| Tool | Contract |
|---|---|
| Node.js | Backend contract: `24.17.0`; frontend supports current Node 24 LTS-compatible tooling |
| npm | Backend contract: `11`; frontend uses its own lockfile |
| Docker Engine | Required for local Compose and image checks |
| Docker Compose v2 | Required for root and project Compose validation |

## Backend Commands

Run from `rss-habersoft-com`:

```bash
npm ci
npm run prisma:generate
npm run lint
npm run typecheck
npm test
npm run test:auth
npm run test:production-evidence
npm run test:production-operational-smoke-evidence
npm run docs:verify
npm run repository:hygiene:verify
npm run release:verify
npm run build
npm audit --omit=dev
```

`npm run release:verify` requires the same local non-secret `DATABASE_URL` convention documented in the backend guide when Prisma validation needs one. Do not point local verification at production.

## Frontend Commands

Run from `rss-admin-ui`:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

The admin UI uses fixed same-origin browser routes `/status-api/health/live` and `/status-api/health/ready`. Its frontend runtime maps only those routes to the configured server-only `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` `/health/live` and `/health/ready` routes with no credentials, no browser persistence, no automatic polling, no generic proxy, and no backend writes. It remains not deployed.

## Root Docker Workflow

The root [`compose.yaml`](compose.yaml) owns local full-stack orchestration for PostgreSQL, Redis, backend API/worker, local JWKS fixture, and the admin UI.

Use non-secret local values:

```bash
POSTGRES_USER=main_service
POSTGRES_PASSWORD=main_service_local_password
POSTGRES_DB=main_service
DATABASE_URL=postgresql://main_service:main_service_local_password@postgres:5432/main_service?schema=public
docker compose config
```

Root Compose wires `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://main-service-api:3000` for local-only same-origin health rehearsal. The root admin UI port is `8081`, selected to avoid the backend API port (`3000` container, commonly `3200` on production loopback), PostgreSQL, Redis, and the existing auth admin UI port. No root Compose command deploys production.

## Documentation Map

- [Root production guide](PRODUCTION.md) - product-level deployment boundaries and migration status.
- [Backend production guide](rss-habersoft-com/PRODUCTION.md) - backend canonical production operations and evidence history.
- [Admin UI production guide](rss-admin-ui/PRODUCTION.md) - frontend read-only status dashboard delivery contract.
- [Admin UI API/auth contract](rss-admin-ui/.docs/api-auth-contract.md) - deferred Tenant/admin authentication boundary.
- [Admin UI read-only dashboard contract](rss-admin-ui/.docs/read-only-status-dashboard.md) - read-only dashboard behavior.
- [Admin UI same-origin health transport](rss-admin-ui/.docs/same-origin-health-transport.md) - MS-020C health transport contract and local rehearsal.
- [Backend detailed docs](rss-habersoft-com/.docs/README.md) - backend service and evidence documentation.

## Production Evidence Status

The backend production evidence series remains closed and is not reopened by this topology milestone:

| Milestone | Result |
|---|---|
| MS-018C | `PASSED` |
| MS-019B | `PARTIAL_ACCEPTED` |
| MS-019C | `PRODUCTION_BACKUP_RESTORE_VERIFIED` |
| MS-019D | `PARTIAL_ACCEPTED` |
| MS-019E | `SUCCESS` |
| MS-019F | `SUCCESS_GOVERNANCE_ACCEPTED` |

MS-020C adds a local/tested same-origin health transport contract and local full-stack rehearsal for the read-only admin status dashboard. It does not deploy, restart, pull on, or contact production.

## No-Secret Policy

Tracked files must not contain production credentials, database URLs with real passwords, Agent keys, JWTs, private keys, raw production evidence bodies, or private host credentials. External operator evidence lives under ignored `operator-state/`; central markdown docs may live under ignored `.md/`.

## Path Conventions

Repository commands should use relative paths. A local Windows checkout may be placed at `C:\Users\EVO-MRDM\Desktop\habersoft-rss`, but tracked automation must not depend on that absolute path.
