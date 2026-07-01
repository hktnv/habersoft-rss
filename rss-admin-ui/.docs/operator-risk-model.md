# Operator Risk Model and Evidence Bridge

Status: `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED`.

MS-026C keeps the accepted status dashboard, authenticated admin shell, read-only Operations Overview, read-only Operations Drilldown, and MS-026B route/proxy/auth smoke boundaries intact. It improves operator automation only; Codex still does not deploy, restart, rebuild, mutate production, perform a credentialed production login, read real secrets, seed production, create a tag, create a release, or create a PR.

## One-command path

The preferred operator entry point is:

```bash
npm run ops:production:retest -- --dry-run
npm run ops:production:retest -- --retest-only --endpoint https://rss-panel.habersoft.com --nginx-config-file <operator-generated-nginx-conf>
npm run ops:production:retest -- --apply --endpoint https://rss-panel.habersoft.com --nginx-config-file <operator-generated-nginx-conf>
```

`--dry-run` prints a redacted plan. `--retest-only` performs non-mutating acceptance checks. `--apply` composes the existing backend `ops:production:recreate:api-worker -- --apply`, frontend `ops:compose:recreate -- --apply`, and lower-level `ops:production:acceptance:redacted` helpers. Credentials remain environment-only through `ADMIN_AUTH_SMOKE_USERNAME` and `ADMIN_AUTH_SMOKE_PASSWORD`; CLI credential, cookie, CSRF, idempotency, token, secret, and actionRef arguments are rejected.

Supporting commands remain available:

```bash
npm run ops:production:retest:redacted
npm run ops:production:acceptance:redacted -- --endpoint https://rss-panel.habersoft.com
npm run ops:feed-recheck:eligibility:redacted -- --endpoint https://rss-panel.habersoft.com
npm run ops:browser-evidence:verify -- --file <redacted-browser-evidence.json>
npm run verify:browser-evidence
npm run verify:operator-automation
```

If credentials are absent, scripts report `AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED` instead of treating the missing credential as a failed login. That class means an authenticated browser operator can export redacted evidence from Operations Drilldown and verify it with `ops:browser-evidence:verify`.

## Risk tiers

CRITICAL / BLOCKING:

- secret, credential, cookie, session, CSRF, idempotency, actionRef, raw body, raw log, Agent key, Tenant bearer/JWT, or raw feed URL leakage;
- browser persistence of auth material;
- unsafe admin write route, missing CSRF/idempotency on the bounded action, or wildcard admin proxy expansion;
- unknown `/admin-api/*` falling back to HTML;
- unresolved `__ADMIN_UI_` markers or generated Nginx missing exact summary, drilldown, or feed-recheck routes;
- production mutation by Codex;
- real credential supplied through a CLI argument.

HIGH / APPLY ATTENTION:

- production upstream unreachable in the apply path;
- frontend backend-network overlay missing when a service-DNS upstream is configured;
- backend auth env not wired for apply;
- image tag missing for an apply plan;
- route proof unavailable for final operator acceptance.

MEDIUM / DIAGNOSTIC WARNING:

- optional/defaulted env values missing;
- host Node/npm mismatch when Docker or declared runtime validation passes;
- no eligible feed recheck target;
- credential-free auth smoke cannot close authenticated checks;
- operator browser evidence missing.

LOW / INFO:

- npm update notices;
- CRLF checkout notices that do not alter required blobs;
- Prisma update notices;
- non-sensitive generated receipt path.

## Browser evidence bridge

Authenticated admins can use **Copy redacted evidence** in Operations Drilldown. The exported JSON contains only schema, source, milestone, generated timestamp, authenticated boolean, drilldown status, aggregate feed/ingestion counts, eligible-target count, effect status, and safe classifications such as `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`, and `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED`.

The browser evidence schema and verifier reject cookies, session IDs, CSRF tokens, idempotency keys, raw `actionRef`, raw feed URLs, private hostnames, local filesystem paths, browser storage values, stack traces, raw response bodies, secrets, password material, Authorization/Bearer values, Agent keys, Tenant tokens, and unknown fields.

## Feed-recheck closure flow

Production currently remains `NO_ELIGIBLE_FEED_RECHECK_TARGET` and `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`. That is not a failure and is not effect acceptance.

When a real eligible feed appears through normal production operation:

1. The operator logs into the admin UI.
2. The operator opens Operations Drilldown.
3. The operator identifies an eligible row without exposing the raw `actionRef`.
4. The operator triggers one bounded recheck with explicit UI confirmation.
5. The UI shows an accepted or already-pending bounded result.
6. The operator exports redacted browser evidence.
7. The operator runs `npm run ops:browser-evidence:verify -- --file <redacted-browser-evidence.json>`.
8. The operator reports only the verifier classification, durable receipt path/hash, and feed-recheck effect status.

Do not create, seed, or fake a production feed/actionRef to close this boundary.
