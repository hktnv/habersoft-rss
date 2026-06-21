# Staging Operator Handoff Checklist

Bundle: MS-017B3 staging operator handoff
Application: {{APPLICATION}} {{APPLICATION_VERSION}}
Master: {{MASTER_RELEASE}} / {{MASTER_HASH}} / {{MASTER_COUNT}}
Platform contract: {{PLATFORM}}
Edge mode: {{EDGE_MODE}}
Compose project: {{PROJECT_NAME}}
API host port: {{API_PORT}}
Generated at: {{GENERATED_AT}}

## Scope

This checklist prepares non-production staging host inputs for the next read-only remote preflight. It does not approve a target, create secrets, create known_hosts, create a remote marker, transfer a release package, mutate Docker resources, deploy staging, deploy production, publish artifacts, create a tag, create a GitHub Release, or change DNS/TLS/CyberPanel live state.

## Mandatory Operator Steps

1. generate handoff bundle
2. hosting/operator reviews host requirements
3. provision non-production host
4. pre-create staging marker
5. verify fingerprint out-of-band and create pinned known_hosts
6. scaffold target/env externally
7. set approved=true only after review
8. fill/generate staging secrets
9. local inputs verify
10. known_hosts offline inspect
11. provide STAGING_TARGET_FILE and STAGING_ENV_FILE

## Review Gates

- Confirm the host is non-production and not a production alias.
- Confirm Docker Engine and Docker Compose v2 are available to the deploy user without an interactive prompt.
- Confirm the API is published through the loopback-only edge contract and that PostgreSQL, Redis and worker ports are not public.
- Confirm PostgreSQL and Redis named volumes are persistent.
- Confirm an off-host PostgreSQL backup path exists before any rollout milestone.
- Confirm host sizing is based on site measurements, not invented CPU/RAM values.
- Confirm the single-host failure domain is accepted for this staging phase.
- Confirm the target descriptor remains external and `approved=false` until operator review is complete.
- Confirm the env file remains external and contains only staging secrets after it is filled.
- Confirm local rehearsal evidence is treated as local-only and not as remote staging proof.

## Handoff Acceptance

The bundle is acceptable only when `npm run staging:handoff:verify` passes against the external bundle directory and the checksum file matches every generated file. The next bounded milestone remains read-only remote preflight; deployment is still out of scope.
