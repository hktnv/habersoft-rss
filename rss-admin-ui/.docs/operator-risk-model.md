# Operator Risk Model and Evidence Bridge

Status: `SUCCESS_MS_027B_R2_EVIDENCE_AUTOMATION_REGRESSION_MODE_LANDED_OPERATOR_RETEST_OPTIONAL`.

MS-026C keeps the accepted status dashboard, authenticated admin shell, read-only Operations Overview, read-only Operations Drilldown, and MS-026B route/proxy/auth smoke boundaries intact. It improves operator automation only; Codex still does not deploy, restart, rebuild, mutate production, perform a credentialed production login, read real secrets, seed production, create a tag, create a release, or create a PR.

MS-026C-R1 closes the MS-026C operator automation/retest residual by operator-reported production evidence only. The reported classes are `OPERATOR_PROMOTION_RETEST_REDACTED_OK`, `NGINX_ROUTE_PROOF_ACCEPTED`, `browser-evidence-verify-ok`, `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, and `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`; critical risk `none`; no production contact by Codex. Feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`. No production feed was created, seeded, or faked. No fake actionRef was generated. The local closure guard is `npm run verify:operator-automation-acceptance`.

MS-027A extends the model with authenticated admin feed onboarding and keeps production action ownership with the operator. The route smoke class is `FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED`, browser evidence includes `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE`, and the source-delivery result is `SUCCESS_MS_027A_ADMIN_FEED_ONBOARDING_AND_ELIGIBLE_TARGET_READINESS_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`. Codex did not perform production contact. No production feed was created, seeded, or faked.

MS-027A-R2 closes production promotion/image-freshness and feed-onboarding route-smoke acceptance by operator report only. Accepted classes are `OPERATOR_PROMOTION_RETEST_REDACTED_OK`, `NGINX_ROUTE_PROOF_ACCEPTED`, `browser-evidence-verify-ok`, `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE`, `MS-027A-R2_PRODUCTION_PROMOTION_IMAGE_FRESHNESS_ACCEPTED_OPERATOR_REPORTED`, and `MS-027A-R2_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED_OPERATOR_REPORTED`; image freshness accepted; backend runtime image revision matched current HEAD; frontend runtime image revision matched current HEAD; feed onboarding route smoke accepted; authenticated browser evidence accepted. Feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`. Feed recheck effect acceptance remains future work requiring a naturally existing eligible target and redacted browser evidence. No production feed was created, seeded, or faked. No fake actionRef was generated. There was no production contact by Codex. Guard: `npm run verify:production-feed-onboarding-acceptance`; receipt: `operator-state/admin-ui-production-activation/ms-027a-r2-promotion-feed-onboarding-route-smoke-accepted-operator-reported-receipt.json`.

MS-027B adds `SUCCESS_MS_027B_FEED_ONBOARDING_RECHECK_EFFECT_FLOW_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED` and `MS-027B_RISK_BALANCED_GUARDRAILS` for feed onboarding plus recheck effect closure. Accepted low-risk completion classes are `FEED_ONBOARDING_EFFECT_ACCEPTED` and `FEED_RECHECK_EFFECT_ACCEPTED`. Diagnostic pending classes are `PENDING_FEED_ONBOARDING_ASYNC_PROCESSING`, `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`, `PENDING_FEED_RECHECK_COOLDOWN`, `FEED_ONBOARDING_EFFECT_PENDING`, `FEED_RECHECK_EFFECT_PENDING`, and `OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON`. Safe-validation rejection classes `FEED_ONBOARDING_REJECTED_SAFE_VALIDATION` and `FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION` fail closed.

MS-027B-R1 closes bounded feed onboarding plus recheck effect production acceptance by operator report only. Status is `MS-027B-R1_FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`, result is `SUCCESS_MS_027B_R1_FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTANCE_CLOSED_OPERATOR_REPORTED_EVIDENCE_AUTOMATION_LANDED`, and source type is `operator_reported`. Accepted classes are `FEED_ONBOARDING_EFFECT_ACCEPTED`, `FEED_RECHECK_EFFECT_ACCEPTED`, `browser-evidence-verify-ok`, and `NGINX_ROUTE_PROOF_ACCEPTED`; `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET is closed for the bounded MS-027B feed onboarding plus recheck effect scope`. Codex did not independently perform a credentialed production login; no production contact by Codex; no production mutation by Codex; no production feed was created, seeded, or faked; No fake actionRef was generated. Guard: `npm run verify:production-feed-effect-acceptance`; receipt: `operator-state/admin-ui-production-activation/ms-027b-r1-feed-onboarding-recheck-effect-accepted-operator-reported-receipt.json`.

MS-027B-R2 records `SUCCESS_MS_027B_R2_EVIDENCE_AUTOMATION_REGRESSION_MODE_LANDED_OPERATOR_RETEST_OPTIONAL`. MS-027B-R1 feed onboarding plus recheck effect production acceptance remains accepted. Do not claim a fresh onboarding effect from an already-present feed regression retest. In regression mode with the tracked prior ledger present, redacted evidence can classify onboarding as `FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED`, `FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE`, and `FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK`; current recheck evidence can classify `RECHECK_EFFECT_ACCEPTED_REGRESSION_OK` when `FEED_RECHECK_EFFECT_ACCEPTED` is observed. If the prior ledger is absent or explicitly disabled, missing fresh onboarding effect evidence remains `OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON`.

## One-command path

The preferred operator entry point is:

```bash
npm run ops:production:retest -- --dry-run
npm run ops:production:retest -- --retest-only --endpoint https://rss-panel.habersoft.com --nginx-config-file <operator-generated-nginx-conf>
npm run ops:production:retest -- --apply --endpoint https://rss-panel.habersoft.com --nginx-config-file <operator-generated-nginx-conf>
npm run ops:production:retest -- --retest-only --endpoint https://rss-panel.habersoft.com --browser-evidence-file <redacted-browser-evidence.json>
```

`--dry-run` prints a redacted plan. `--retest-only` performs non-mutating acceptance checks. `--apply` composes the existing backend `ops:production:recreate:api-worker -- --apply`, frontend `ops:compose:recreate -- --apply`, and lower-level `ops:production:acceptance:redacted` helpers. Credentials remain environment-only through `ADMIN_AUTH_SMOKE_USERNAME` and `ADMIN_AUTH_SMOKE_PASSWORD`; CLI credential, cookie, CSRF, idempotency, token, secret, and actionRef arguments are rejected.

Supporting commands remain available:

```bash
npm run ops:production:retest:redacted
npm run ops:production:acceptance:redacted -- --endpoint https://rss-panel.habersoft.com --browser-evidence-file <redacted-browser-evidence.json>
npm run ops:production:acceptance:redacted -- --endpoint https://rss-panel.habersoft.com --browser-evidence-stdin
npm run ops:feed-recheck:eligibility:redacted -- --endpoint https://rss-panel.habersoft.com
npm run ops:browser-evidence:verify -- --file <redacted-browser-evidence.json>
npm run ops:browser-evidence:verify -- --stdin
npm run verify:browser-evidence
npm run verify:admin-feed-onboarding
npm run verify:operator-automation
npm run verify:production-feed-effect-acceptance
npm run verify:evidence-regression-mode
```

If credentials are absent, scripts report `AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED` instead of treating the missing credential as a failed login. That class means an authenticated browser operator can export redacted evidence from Operations Drilldown with **Copy redacted evidence** or **Download redacted evidence JSON** and verify it with `ops:browser-evidence:verify`. Acceptance scripts also support `ops:production:acceptance:redacted -- --browser-evidence-stdin`, `--browser-evidence-file`, automatic route proof, and durable `--write-receipt` output without exposing raw evidence material.

## Risk tiers

CRITICAL / BLOCKING:

- secret, credential, cookie, session, CSRF, idempotency, actionRef, raw body, raw log, Agent key, Tenant bearer/JWT, or raw feed URL leakage;
- browser persistence of auth material;
- unsafe admin write route, missing CSRF/idempotency on the bounded action, or wildcard admin proxy expansion;
- unsafe admin feed onboarding route, missing CSRF/idempotency, or raw feed URL in response or evidence;
- unknown `/admin-api/*` falling back to HTML;
- unresolved `__ADMIN_UI_` markers or generated Nginx missing exact summary, drilldown, feed-recheck, or feed-onboarding routes;
- production mutation by Codex, which always fails closed;
- real credential supplied through a CLI argument.

HIGH / APPLY ATTENTION:

- production upstream unreachable in the apply path;
- frontend backend-network overlay missing when a service-DNS upstream is configured;
- backend auth env not wired for apply;
- image tag missing for an apply plan;
- route proof unavailable for final operator acceptance.
- feed onboarding exact route missing from generated Nginx proof.

MEDIUM / DIAGNOSTIC WARNING:

- optional/defaulted env values missing;
- host Node/npm mismatch when Docker or declared runtime validation passes;
- no eligible feed recheck target;
- feed onboarding available but an explicit operator action/retest is still required;
- credential-free auth smoke cannot close authenticated checks;
- operator browser evidence missing.

LOW / INFO:

- npm update notices;
- CRLF checkout notices that do not alter required blobs;
- Prisma update notices;
- non-sensitive generated receipt path.

## Browser evidence bridge

Authenticated admins can use **Copy redacted evidence** or **Download redacted evidence JSON** in Operations Drilldown. The exported JSON contains only schema, source, milestone, generated timestamp, authenticated boolean, drilldown status, aggregate feed/ingestion counts, eligible-target count, effect status, feed onboarding availability fields, and safe classifications such as `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE`, `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`, MS-027B-R1 `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED`, and MS-027B-R2 `FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK`.

The browser evidence schema and verifier reject cookies, session IDs, CSRF tokens, idempotency keys, raw `actionRef`, raw feed URLs, private hostnames, local filesystem paths, browser storage values, stack traces, raw response bodies, secrets, password material, Authorization/Bearer values, Agent keys, Tenant tokens, and unknown fields.

MS-027A browser evidence includes `feed_onboarding_available`,
`feed_onboarding_status`, `no_eligible_target`, and `critical_risk`; it still
rejects raw feed URLs and credential material.

## Feed-recheck closure flow

Production now records `FEED_ONBOARDING_EFFECT_ACCEPTED` and `FEED_RECHECK_EFFECT_ACCEPTED` for the bounded MS-027B feed onboarding plus recheck effect scope by operator report. `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET is closed for the bounded MS-027B feed onboarding plus recheck effect scope`. Later already-present feed retests are regression/continuity evidence, not contradictory failures of the accepted onboarding effect. The MS-026C-R1 durable sanitized receipt lives outside Git under `operator-state/admin-ui-production-activation/ms-026c-r1-operator-automation-accepted-feed-recheck-pending-no-target-receipt.json`. The MS-027A-R2 durable sanitized receipt lives outside Git under `operator-state/admin-ui-production-activation/ms-027a-r2-promotion-feed-onboarding-route-smoke-accepted-operator-reported-receipt.json`. The MS-027B-R1 durable sanitized receipt lives outside Git under `operator-state/admin-ui-production-activation/ms-027b-r1-feed-onboarding-recheck-effect-accepted-operator-reported-receipt.json`.

For future regression evidence when a real eligible feed appears through normal production operation:

1. The operator logs into the admin UI.
2. The operator opens Operations Drilldown.
3. The operator identifies an eligible row without exposing the raw `actionRef`.
4. The operator triggers one bounded recheck with explicit UI confirmation.
5. The UI shows an accepted or already-pending bounded result.
6. The operator exports redacted browser evidence.
7. The operator runs `npm run ops:browser-evidence:verify -- --file <redacted-browser-evidence.json>` or `npm run ops:browser-evidence:verify -- --stdin`.
8. The operator reports only the verifier classification, durable receipt path/hash, and feed-recheck effect status.

Do not create, seed, or fake a production feed/actionRef to close this boundary.

Operators can provide verifier-accepted redacted browser evidence through `npm run ops:production:retest -- --browser-evidence-file <redacted-browser-evidence.json>` or `npm run ops:production:acceptance:redacted -- --browser-evidence-stdin` without command-line credentials. Local guards: `npm run verify:feed-onboarding-recheck-effect-flow`, `npm run verify:production-feed-effect-acceptance`, and `npm run verify:evidence-regression-mode`. No production feed was created, seeded, or faked by Codex, and no fake actionRef was generated.
