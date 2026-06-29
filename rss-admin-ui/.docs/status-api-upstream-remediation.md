# Status API Production Networking Remediation

Status: `MS-023C_STATUS_API_PRODUCTION_NETWORK_REMEDIATION_PACKAGE_READY_OPERATOR_FIX_REQUIRED - NOT_DEPLOYED`.

MS-023C is a repository-level remediation package for an operator-reported live install blocker. It does not contact production, mutate the live server, capture rollback baseline, read secrets, publish an image, create a Git tag, create a GitHub Release, or create a PR.

The bounded live status for the operator transcript remains `OPERATOR_DEPLOYED_HEALTHZ_VERIFIED_STATUS_API_BLOCKED`. The evidence is operator-reported; Codex did not perform live verification in MS-023C. Admin UI full production acceptance remains pending until `/status-api/health/ready` is verified after the operator-managed production networking fix.

## Operator-Reported Symptom

The operator reported:

- server checkout pulled MS-023B successfully;
- backend host-loopback ready succeeds at `http://127.0.0.1:3200/health/ready` with `postgres=up`, `redis=up`, and `tenantAuth=up`;
- frontend local loopback health succeeds at `http://127.0.0.1:8081/healthz`;
- public frontend health succeeds at `https://rss-panel.habersoft.com/healthz`;
- public `https://rss-panel.habersoft.com/status-api/health/ready` still returns `502` after setting:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200
```

## Diagnosis

The admin UI production package runs in a Docker bridge container. Inside that container, `127.0.0.1`, `localhost`, `::1`, `[::1]`, and `0.0.0.0` refer to the admin UI container or an unspecified local address. They do not refer to the Docker host loopback where the backend is published on `127.0.0.1:3200`.

That makes the reported `127.0.0.1:3200` upstream a container-loopback upstream misconfiguration. It can produce a safe browser `502` even while the backend is healthy from the host namespace.

The public edge anti-pattern from MS-023B remains invalid:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss.habersoft.com
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=https://rss.habersoft.com
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss-panel.habersoft.com
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=https://rss-panel.habersoft.com
```

## Supported Upstream Modes

| Mode | Use when | Upstream |
|---|---|---|
| Backend Docker network service DNS | Preferred when the admin UI container can attach to the backend Docker network. | `http://<backend_service_or_alias>:3000` |
| Host-gateway | Only after an operator-run check proves the backend port is reachable from inside a container through Docker host-gateway. | `http://host.docker.internal:3200` |

Do not use `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0` as admin UI upstream origins in the production Docker bridge package.

The backend production Compose service name in this repository is `main-service-api` and the backend container port is `3000`. The backend Docker network name is operator-owned runtime state. Do not guess it in Git.

## Preferred Backend-Network Application

Use the base production compose file plus the backend-network overlay:

```bash
ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://<backend_service_or_alias>:3000
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://<backend_service_or_alias>:3000

docker compose --env-file <operator-env> \
  -f rss-admin-ui/deploy/production/compose.yaml \
  -f rss-admin-ui/deploy/production/compose.backend-network.yaml \
  up -d --force-recreate
```

For the repository's backend production Compose service, the expected service alias is:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://main-service-api:3000
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://main-service-api:3000
```

The operator must supply the actual Docker network name as `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>`.

## Host-Gateway Alternative

Host-gateway mode is only valid after the operator proves reachability from inside a container. A host-side `curl http://127.0.0.1:3200/health/ready` is not enough.

Operator-side proof shape, with placeholders:

```bash
docker run --rm --add-host=host.docker.internal:host-gateway <curl-capable-image> \
  curl -fsS http://host.docker.internal:3200/health/ready
```

Only if that container-side proof succeeds may the operator use:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://host.docker.internal:3200
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://host.docker.internal:3200
```

## Redacted Smoke Checks

After changing only the operator-owned admin UI runtime env/compose invocation and recreating only the admin UI runtime, capture redacted evidence:

```bash
curl -fsS http://127.0.0.1:8081/healthz
curl -fsS https://rss-panel.habersoft.com/healthz
curl -i https://rss-panel.habersoft.com/status-api/health/ready
curl -i https://rss-panel.habersoft.com/status-api/health/live
curl -i https://rss-panel.habersoft.com/admin-auth/session
```

Expected safe result for full status-api acceptance:

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
npm run test:status-api-production-networking
npm run test:status-api-upstream-remediation
```

The verifier rejects public Habersoft edge upstreams and Docker bridge loopback/unspecified upstreams, accepts the documented service DNS and proven host-gateway forms, checks the backend-network overlay structurally, and confirms browser source/build output does not expose upstream origins.

The local harness simulates public-edge `403`, container-loopback startup rejection, unreachable upstream `502`, and backend-network service-alias success. It proves health remains credential-free, query strings and request bodies are not forwarded, upstream `Set-Cookie` / `WWW-Authenticate` are not relayed, raw upstream diagnostics are not exposed, and successful upstream health JSON is not masked.

## Claim Boundary

MS-023C lands a remediation package and runbook only. Production mutation remains operator-managed. Admin UI public shell is operator-reported up, but full production acceptance remains pending unless a future authorized step verifies the public `/status-api/health/ready` path after the production networking fix.
