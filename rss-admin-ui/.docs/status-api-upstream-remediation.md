# Status API Production Networking Remediation

Status: `MS-024C_PRODUCTION_OVERLAY_CANONICALIZATION_READY_OPERATOR_RETEST_REQUIRED`.

MS-023C is a repository-level remediation package for an operator-reported live install blocker. MS-023D records that the live status-api blocker is now resolved for the read-only status-dashboard transport. MS-024B adds graduated guardrails after the operator-reported latest recreate showed a restart-loop and generic auth-smoke failure. MS-024C canonicalizes the backend-network overlay/helper path after the operator proved that plain `deploy/production/compose.yaml` can fail for service-DNS upstreams such as `main-service-api`. Codex did not mutate the live server, capture rollback baseline, read secrets, publish an image, create a Git tag, create a GitHub Release, or create a PR.

The bounded live status is now `MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED`. Evidence source is `operator_reported` plus `codex_public_readonly_verified`. Authenticated admin-shell production acceptance remains pending because `/admin-auth/session` returns `501 not_configured`, classified as `AUTH_NOT_CONFIGURED_RESIDUAL`.

MS-024B does not claim the latest live recreate is healthy. It is no live acceptance claimed until the operator retests. The authenticated admin shell remains pending.

## MS-023D Accepted Result

The operator reported and Codex verified using public read-only GET requests with no cookies or auth headers:

- `https://rss-panel.habersoft.com/healthz -> 200 ok`;
- `https://rss-panel.habersoft.com/status-api/health/live -> 200, status=live`;
- `https://rss-panel.habersoft.com/status-api/health/ready -> 200, status=ready, postgres=up, redis=up, tenantAuth=up`;
- `https://rss-panel.habersoft.com/admin-auth/session -> 501, configured=false, authenticated=false, status=not_configured`.

The status-api production networking blocker is closed for the read-only dashboard transport. The admin-auth result is a separate backend auth activation residual. Because `/healthz` and `/status-api/health/*` pass, do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` for the auth residual. Verify backend runtime admin-auth env placement and backend API restart/recreate under the operator rollback plan.

## Operator-Reported Symptom

Historical MS-023C symptom:

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

Under MS-024B these anti-patterns no longer crash-loop the static admin UI. `/healthz` stays available, and the exact `/status-api/health/live`, `/status-api/health/ready`, and configured `/admin-auth/*` proxy routes return bounded JSON such as `invalid_upstream_origin`, `public_edge_upstream_rejected`, `upstream_unavailable`, or `upstream_forbidden`. This is graduated guardrails, not no guardrails.

MS-024C adds one more distinction: backend service DNS without the backend-network overlay is an operator invocation error. The helper path blocks before recreate when `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` or `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` uses service DNS but `ADMIN_UI_BACKEND_DOCKER_NETWORK` is missing. Runtime proxy generation also resolves upstreams at request time, so if this mistake reaches a container, `/healthz`, `env-config.js`, and static assets remain available and exact proxy routes fail closed with redacted JSON `502` instead of hiding all diagnostics behind an Nginx startup crash.

## Supported Upstream Modes

| Mode | Use when | Upstream |
|---|---|---|
| Backend Docker network service DNS | Preferred when the admin UI container can attach to the backend Docker network. | `http://<backend_service_or_alias>:3000` |
| Host-gateway | Only after an operator-run check proves the backend port is reachable from inside a container through Docker host-gateway. | `http://host.docker.internal:3200` |

Do not use `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0` as admin UI upstream origins in the production Docker bridge package.

Do not use 127.0.0.1 for admin UI production upstream origins unless the request is explicitly inside the backend host namespace; inside the admin UI Docker bridge container it is container loopback, not the backend service.

The backend production Compose service name in this repository is `main-service-api` and the backend container port is `3000`. The backend Docker network name is operator-owned runtime state. Do not guess it in Git.

## Preferred Backend-Network Application

Use the helper path as the recommended production path. It auto-includes the backend-network overlay when the backend Docker network is configured and blocks before a known bad recreate if service DNS is configured without the network:

```bash
cd /opt/habersoft-rss/rss-admin-ui
npm run production:diagnose:redacted
npm run ops:compose:config
npm run ops:compose:up -- --force-recreate rss-admin-ui
npm run ops:compose:ps
npm run ops:compose:logs -- rss-admin-ui
```

The direct advanced equivalent uses the base production compose file plus the backend-network overlay:

```bash
ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://<backend_service_or_alias>:3000
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://<backend_service_or_alias>:3000

docker compose --env-file <operator-env> \
  -f rss-admin-ui/deploy/production/compose.yaml \
  -f rss-admin-ui/deploy/production/compose.backend-network.yaml \
  up -d --no-build --pull never --force-recreate rss-admin-ui
```

For the repository's backend production Compose service, the expected service alias is:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://main-service-api:3000
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://main-service-api:3000
```

The operator must supply the actual Docker network name as `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>`.

Plain `deploy/production/compose.yaml` remains useful for static inspection, config rendering with safe defaults, and degraded/no-upstream local scenarios. It is not the complete production runtime invocation for service-DNS upstreams like `http://main-service-api:3000`.

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

Expected safe result for read-only status-dashboard acceptance:

```text
/status-api/health/ready -> HTTP 200
dependencies.postgres -> up
dependencies.redis -> up
dependencies.tenantAuth -> up
```

Evidence must be redacted and bounded. Record only status codes, safe cache/proxy headers, and safe health fields. Do not record cookies, auth headers, raw upstream diagnostics, production secrets, database URLs, Redis credentials, JWTs, Agent keys, or raw logs.

If `/admin-auth/session` returns HTTP `501` with `status=not_configured`, classify it as `AUTH_NOT_CONFIGURED_RESIDUAL`. That residual points to backend admin-auth runtime env placement, or to an unactivated frontend auth proxy, not to the already accepted health upstream.

For MS-024C, the redacted residual diagnostic classes are: backend admin-auth mode disabled or missing, backend admin username missing or placeholder, backend password hash missing/placeholder/invalid, backend session secret missing/weak, backend Redis/session dependency unreachable, or frontend proxy reachable while the backend auth endpoint reports not configured. The next action is the backend admin-auth config verifier with an operator-owned backend env file, then operator-authorized backend API/worker recreate, then frontend helper recreate, then `auth-smoke:redacted`.

## Local Validation

Run from `rss-admin-ui`:

```bash
npm run verify:production-upstream-contract
npm run verify:operator-ergonomics
npm run verify:production-overlay-canonicalization
npm run test:status-api-production-networking
npm run test:status-api-upstream-remediation
```

The verifier rejects public Habersoft edge upstreams and Docker bridge loopback/unspecified upstreams, accepts the documented service DNS and proven host-gateway forms, checks the backend-network overlay structurally, and confirms browser source/build output does not expose upstream origins.

The local harness simulates public-edge `403`, container-loopback route degradation, unreachable upstream `502`, and backend-network service-alias success. It proves `/healthz` remains available in degraded mode, health remains credential-free, query strings and request bodies are not forwarded, upstream `Set-Cookie` / `WWW-Authenticate` are not relayed, raw upstream diagnostics are not exposed, and successful upstream health JSON is not masked.

## MS-024B Operator Retest

Use the MS-024B operator retest checklist in `../PRODUCTION.md`. Short commands:

```bash
docker compose -f deploy/production/compose.yaml ps
npm run ops:compose:ps
npm run ops:compose:logs -- rss-admin-ui
npm run production:diagnose:redacted
npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
```

`habersoft-rss-frontend:latest` is an operator-managed mutable local image default for inspection only. Release candidates should still use an immutable `RSS_ADMIN_UI_IMAGE`.

## Claim Boundary

MS-023C lands a remediation package and runbook only. Production mutation remains operator-managed. Admin UI public shell is operator-reported up, but full production acceptance remains pending unless a future authorized step verifies the public `/status-api/health/ready` path after the production networking fix.

MS-023D supersedes that pending status for the read-only status-dashboard transport: `/healthz`, `/status-api/health/live`, and `/status-api/health/ready` are accepted. Authenticated admin-shell production acceptance remains pending until `AUTH_NOT_CONFIGURED_RESIDUAL` is resolved with backend runtime auth env placement and redacted auth smoke evidence.
