# Status API Upstream Remediation

Status: `MS-023B_STATUS_API_UPSTREAM_REMEDIATION_PACKAGE_READY_OPERATOR_FIX_REQUIRED - NOT_DEPLOYED`.

MS-023B is a repository-level remediation package for an operator-reported live install blocker. It does not contact production, mutate the live server, capture rollback baseline, read secrets, publish an image, create a Git tag, create a GitHub Release, or create a PR.

The bounded live status for the operator transcript is `OPERATOR_DEPLOYED_HEALTHZ_VERIFIED_STATUS_API_BLOCKED`. The evidence is operator-reported; Codex did not perform live verification in MS-023B. Admin UI full production acceptance remains pending until `/status-api/health/ready` is verified after the operator-managed config fix.

## Operator-Reported Symptom

The operator reported:

- backend local ready succeeds at `http://127.0.0.1:3200/health/ready` with `postgres=up`, `redis=up`, and `tenantAuth=up`;
- frontend local loopback health succeeds at `http://127.0.0.1:8081/healthz`;
- public frontend health succeeds at `https://rss-panel.habersoft.com/healthz`;
- public `https://rss-panel.habersoft.com/status-api/health/ready` fails while `/healthz` works.

## Cause

The deployed admin UI was configured with this bad upstream:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss.habersoft.com
```

That value points the admin UI server-side proxy at the public backend edge. The public edge can apply WAF, reverse-proxy, host, or policy behavior that does not match the internal backend service path; the reported result was `403 Forbidden`.

Do not configure the admin UI proxy with public edge origins:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss.habersoft.com
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=https://rss.habersoft.com
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss-panel.habersoft.com
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=https://rss-panel.habersoft.com
```

## Fix

Set `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` and, when admin auth is enabled, `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` to an internal backend origin reachable from the admin UI proxy runtime.

Choose the value by runtime topology:

| Topology | Use when | Example |
|---|---|---|
| Host namespace loopback | The admin UI proxy runs in the production host namespace, so `127.0.0.1` is the host loopback. | `http://127.0.0.1:3200` |
| Container-to-host gateway | The admin UI proxy runs in a container and the backend is reachable through the Docker host gateway. Requires the Compose `host.docker.internal:host-gateway` mapping or platform equivalent. | `http://host.docker.internal:3200` |
| Same Docker network service DNS | The admin UI container shares a Docker network with the backend API container. Prefer this when both services can be attached to the same network. | `http://main-service-api:3000` |

The upstream values are server-only. They must not appear in browser assets, `env-config.js`, screenshots, public evidence, or Git. Filled env files are operator-owned runtime config and must remain untracked.

## Operator-Managed Application

1. Capture rollback baseline and current state as an operator action before mutation.
2. Select the internal backend origin appropriate for the actual runtime topology.
3. Update only the operator-owned admin UI runtime env with the internal origin values.
4. Restart or recreate only the admin UI runtime according to the operator-managed runbook.
5. Capture redacted smoke evidence. Do not include secrets, cookies, auth headers, raw logs, or raw diagnostic bodies.

## Post-Fix Smoke Checks

Run these as operator-managed checks after the env fix and admin UI runtime restart/recreate:

```bash
curl -i http://127.0.0.1:3200/health/ready
curl -i http://127.0.0.1:8081/healthz
curl -i http://127.0.0.1:8081/status-api/health/ready
curl -i https://rss-panel.habersoft.com/healthz
curl -i https://rss-panel.habersoft.com/status-api/health/ready
```

Expected safe result:

```text
/status-api/health/ready -> HTTP 200
dependencies.postgres -> up
dependencies.redis -> up
dependencies.tenantAuth -> up
```

Evidence must be redacted and bounded. Record only status codes, safe cache/proxy headers, and safe health fields. Do not record cookies, auth headers, raw upstream diagnostics, production secrets, database URLs, Redis credentials, JWTs, Agent keys, or raw logs.

## Local Validation

Run from `rss-admin-ui`:

```bash
npm run verify:production-upstream-contract
npm run test:status-api-upstream-remediation
```

The verifier rejects public Habersoft edge upstreams, accepts the documented internal examples, checks the operator-managed templates structurally, and confirms browser source/build output does not expose upstream origins.

The local harness simulates a public edge returning `403 Forbidden` and an internal backend returning successful `/health/live` and `/health/ready`. It proves the bad upstream is converted to a bounded browser-safe failure, the internal upstream succeeds, health remains credential-free, query strings and request bodies are not forwarded, and upstream `Set-Cookie` / `WWW-Authenticate` are not relayed.

## Claim Boundary

MS-023B lands a remediation package and runbook only. Production mutation remains operator-managed. Admin UI full production acceptance remains pending unless a future authorized step verifies the public `/status-api/health/ready` path after the internal-upstream fix.
