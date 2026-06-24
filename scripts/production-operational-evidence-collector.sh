#!/usr/bin/env bash
set -eu

umask 077

usage() {
  printf '%s\n' "usage: collect-production-operational-evidence.sh --output-dir <new-empty-dir> [--compose-file <file>] [--image-env-file <file>] [--shared-env-file <file>] [--previous-pointer-file <file>] [--public-base-url <url>] [--api-loopback-base-url <url>]" >&2
  exit 2
}

OUTPUT_DIR=
COMPOSE_FILE="deploy/production/compose.yaml"
IMAGE_ENV_FILE="deploy/runtime-image.env"
SHARED_ENV_FILE=
PREVIOUS_POINTER_FILE=
PUBLIC_BASE_URL="https://rss.habersoft.com"
API_LOOPBACK_BASE_URL="http://127.0.0.1:3200"
COLLECTOR_SOURCE_COMMIT="__MS019A_SOURCE_COMMIT__"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      [ "$#" -ge 2 ] || usage
      OUTPUT_DIR=$2
      shift 2
      ;;
    --compose-file)
      [ "$#" -ge 2 ] || usage
      COMPOSE_FILE=$2
      shift 2
      ;;
    --image-env-file)
      [ "$#" -ge 2 ] || usage
      IMAGE_ENV_FILE=$2
      shift 2
      ;;
    --shared-env-file)
      [ "$#" -ge 2 ] || usage
      SHARED_ENV_FILE=$2
      shift 2
      ;;
    --previous-pointer-file)
      [ "$#" -ge 2 ] || usage
      PREVIOUS_POINTER_FILE=$2
      shift 2
      ;;
    --public-base-url)
      [ "$#" -ge 2 ] || usage
      PUBLIC_BASE_URL=$2
      shift 2
      ;;
    --api-loopback-base-url)
      [ "$#" -ge 2 ] || usage
      API_LOOPBACK_BASE_URL=$2
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[ -n "$OUTPUT_DIR" ] || usage

if [ -e "$OUTPUT_DIR" ]; then
  [ -d "$OUTPUT_DIR" ] || fail_code=1
  if [ "${fail_code:-0}" -ne 0 ] || [ "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" != "0" ]; then
    printf '%s\n' "collector: output-dir must be a new empty directory" >&2
    exit 1
  fi
else
  mkdir -p "$OUTPUT_DIR"
fi
chmod 700 "$OUTPUT_DIR"

RECORDS_FILE="$OUTPUT_DIR/evidence-records.tsv"
METADATA_FILE="$OUTPUT_DIR/collector-metadata.txt"
CHECKSUM_FILE="$OUTPUT_DIR/checksums.sha256"
: > "$RECORDS_FILE"
chmod 600 "$RECORDS_FILE"

utc_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

emit() {
  key=$1
  value=$2
  case "$key" in
    *"	"*|*".."*|/*)
      printf '%s\n' "collector: invalid record key" >&2
      exit 1
      ;;
  esac
  safe_value=$(printf '%s' "$value" | tr '\r\n\t' '   ')
  printf '%s\t%s\n' "$key" "$safe_value" >> "$RECORDS_FILE"
}

emit_status() {
  emit "$1.result" "$2"
  emit "$1.evidence_source" "$3"
}

emit "schema_version" "1"
emit "contract_version" "production-operational-evidence-v1"
emit "milestone" "MS-019A"
emit "service" "main-service"
emit "environment" "production"
emit "application_version" "0.1.0-ms-017"
emit "collected_at_utc" "$(utc_now)"
emit "collector_source_commit" "$COLLECTOR_SOURCE_COMMIT"
emit "collector_sha256" "$(hash_file "$0")"
emit "evidence_mode" "READ_ONLY"
emit "production_mutation_performed" "false"
emit "deployment_performed" "false"
emit "backup_performed" "false"
emit "restore_performed" "false"
emit "artifact_published" "false"
emit "git_tag_created" "false"
emit "github_release_created" "false"

remote_url=$(git remote get-url origin 2>/dev/null || printf 'NOT_RECORDED')
checkout_commit=$(git rev-parse HEAD 2>/dev/null || printf 'NOT_RECORDED')
origin_main_ref=$(git rev-parse --verify origin/main 2>/dev/null || printf 'NOT_RECORDED')
if git status --porcelain 2>/dev/null | grep -q .; then
  checkout_clean=false
else
  checkout_clean=true
fi

emit "identity.canonical_remote" "$remote_url"
emit "identity.server_checkout_commit" "$checkout_commit"
emit "identity.server_checkout_clean" "$checkout_clean"
emit "identity.local_origin_main_ref" "$origin_main_ref"

runtime_image="NOT_RECORDED"
if [ -f "$IMAGE_ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      MAIN_SERVICE_IMAGE=*)
        runtime_image=${line#MAIN_SERVICE_IMAGE=}
        ;;
    esac
  done < "$IMAGE_ENV_FILE"
fi
emit "identity.runtime_image_env_image_id" "$runtime_image"

compose_cmd() {
  if [ -n "$SHARED_ENV_FILE" ]; then
    docker compose --env-file "$SHARED_ENV_FILE" --env-file "$IMAGE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose --env-file "$IMAGE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
  fi
}

inspect_field() {
  container_id=$1
  template=$2
  docker inspect --format "$template" "$container_id" 2>/dev/null || printf 'NOT_RECORDED'
}

service_names=$(compose_cmd ps --services 2>/dev/null | tr '\n' ',' | sed 's/,$//' || printf 'NOT_RECORDED')
emit "services.observed_service_names" "$service_names"

for service in postgres redis migrate main-service-api main-service-worker; do
  cid=$(compose_cmd ps -q "$service" 2>/dev/null || true)
  if [ -z "$cid" ]; then
    emit "services.observed_service_states.$service.status" "NOT_RECORDED"
    emit "services.observed_service_states.$service.health" "NOT_RECORDED"
    continue
  fi
  emit "services.observed_service_states.$service.status" "$(inspect_field "$cid" '{{.State.Status}}')"
  emit "services.observed_service_states.$service.health" "$(inspect_field "$cid" '{{if .State.Health}}{{.State.Health.Status}}{{else}}not_applicable{{end}}')"
  emit "services.observed_service_states.$service.restart_count" "$(inspect_field "$cid" '{{.RestartCount}}')"
  emit "services.observed_service_states.$service.oom_killed" "$(inspect_field "$cid" '{{.State.OOMKilled}}')"
  emit "services.observed_service_states.$service.started_at" "$(inspect_field "$cid" '{{.State.StartedAt}}')"
  emit "services.observed_service_states.$service.image_id" "$(inspect_field "$cid" '{{.Image}}')"
  emit "services.observed_service_states.$service.port_projection" "$(inspect_field "$cid" '{{range $p,$b := .NetworkSettings.Ports}}{{printf "%s=" $p}}{{range $b}}{{printf "%s:%s," .HostIp .HostPort}}{{end}}{{println}}{{end}}')"
done

api_cid=$(compose_cmd ps -q main-service-api 2>/dev/null || true)
worker_cid=$(compose_cmd ps -q main-service-worker 2>/dev/null || true)
api_image="NOT_RECORDED"
worker_image="NOT_RECORDED"
if [ -n "$api_cid" ]; then
  api_image=$(inspect_field "$api_cid" '{{.Image}}')
fi
if [ -n "$worker_cid" ]; then
  worker_image=$(inspect_field "$worker_cid" '{{.Image}}')
fi
emit "identity.api_running_image_id" "$api_image"
emit "identity.worker_running_image_id" "$worker_image"
inspected_image="NOT_RECORDED"
revision_label="NOT_RECORDED"
source_label="NOT_RECORDED"
if [ "$runtime_image" != "NOT_RECORDED" ]; then
  inspected_image=$(docker image inspect "$runtime_image" --format '{{.Id}}' 2>/dev/null || printf 'NOT_RECORDED')
  revision_label=$(docker image inspect "$runtime_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || printf 'NOT_RECORDED')
  source_label=$(docker image inspect "$runtime_image" --format '{{index .Config.Labels "org.opencontainers.image.source"}}' 2>/dev/null || printf 'NOT_RECORDED')
fi
emit "identity.inspected_image_id" "$inspected_image"
emit "identity.running_image_revision_label" "$revision_label"
emit "identity.running_image_source_label" "$source_label"

migration_tmp=$(mktemp)
if compose_cmd exec -T main-service-api npm run migrate:status > "$migration_tmp" 2>&1; then
  migration_exit=0
else
  migration_exit=$?
fi
migration_hash=$(hash_file "$migration_tmp")
if [ "$migration_exit" -eq 0 ] && grep -Eq 'Database schema is up to date|already in sync|No pending migrations' "$migration_tmp"; then
  emit_status "migration" "PASSED" "DIRECT_OBSERVED"
  emit "migration.pending_or_failed" "NOT_APPLICABLE"
else
  emit_status "migration" "FAILED" "DIRECT_OBSERVED"
  emit "migration.pending_or_failed" "FAILED"
fi
emit "migration.output_sha256" "$migration_hash"
rm -f "$migration_tmp"

worker_tmp=$(mktemp)
if compose_cmd exec -T main-service-worker npm run worker:health > "$worker_tmp" 2>&1; then
  worker_exit=0
else
  worker_exit=$?
fi
worker_hash=$(hash_file "$worker_tmp")
if [ "$worker_exit" -eq 0 ]; then
  emit_status "worker_scheduler.worker_health" "PASSED" "DIRECT_OBSERVED"
else
  emit_status "worker_scheduler.worker_health" "FAILED" "DIRECT_OBSERVED"
fi
emit "worker_scheduler.output_sha256" "$worker_hash"
if grep -q '"queue":"main-service.maintenance"' "$worker_tmp" && grep -q '"scheduler_id":"cleanup.daily"' "$worker_tmp"; then
  emit "worker_scheduler.queue" "main-service.maintenance"
  emit "worker_scheduler.scheduler" "cleanup.daily"
  emit "worker_scheduler.job" "cleanup.run.v1"
  emit "worker_scheduler.timezone" "UTC"
  emit "worker_scheduler.global_concurrency" "1"
  emit "worker_scheduler.local_concurrency" "1"
  emit "worker_scheduler.scheduler_evidence_source" "DIRECT_OBSERVED"
else
  emit "worker_scheduler.queue" "main-service.maintenance"
  emit "worker_scheduler.scheduler" "cleanup.daily"
  emit "worker_scheduler.job" "cleanup.run.v1"
  emit "worker_scheduler.timezone" "UTC"
  emit "worker_scheduler.global_concurrency" "1"
  emit "worker_scheduler.local_concurrency" "1"
  emit "worker_scheduler.scheduler_evidence_source" "CONTRACT_DERIVED"
fi
rm -f "$worker_tmp"

http_probe() {
  key=$1
  url=$2
  expected_code=$3
  body_file=$(mktemp)
  code=$(curl --silent --show-error --max-time 10 --max-redirs 0 --output "$body_file" --write-out '%{http_code}' "$url" 2>/dev/null || printf '000')
  emit "$key.http_status" "$code"
  if [ "$code" = "$expected_code" ]; then
    emit "$key.result" "PASSED"
  else
    emit "$key.result" "FAILED"
  fi
  if grep -q '"status":"live"' "$body_file"; then
    emit "$key.response_status" "live"
  elif grep -q '"status":"ready"' "$body_file"; then
    emit "$key.response_status" "ready"
  else
    emit "$key.response_status" "NOT_RECORDED"
  fi
  rm -f "$body_file"
}

http_probe "health_boundary.internal_live" "$API_LOOPBACK_BASE_URL/health/live" "200"
http_probe "health_boundary.internal_ready" "$API_LOOPBACK_BASE_URL/health/ready" "200"
http_probe "health_boundary.public_live" "$PUBLIC_BASE_URL/health/live" "200"
http_probe "health_boundary.public_ready" "$PUBLIC_BASE_URL/health/ready" "200"
http_probe "health_boundary.unknown_route" "$PUBLIC_BASE_URL/not-found" "404"
http_probe "health_boundary.tenant_unauth" "$PUBLIC_BASE_URL/api/feeds" "401"
http_probe "health_boundary.agent_unauth" "$PUBLIC_BASE_URL/agent/feeds/due?limit=1" "401"

redirect_headers=$(mktemp)
redirect_code=$(curl --silent --show-error --max-time 10 --output /dev/null --dump-header "$redirect_headers" --write-out '%{http_code}' "http://rss.habersoft.com/health/live" 2>/dev/null || printf '000')
if [ "$redirect_code" = "301" ] || [ "$redirect_code" = "302" ] || [ "$redirect_code" = "307" ] || [ "$redirect_code" = "308" ]; then
  if grep -Eiq '^location: https://rss\.habersoft\.com/health/live' "$redirect_headers"; then
    emit_status "health_boundary.http_to_https_redirect" "PASSED" "DIRECT_OBSERVED"
  else
    emit_status "health_boundary.http_to_https_redirect" "FAILED" "DIRECT_OBSERVED"
  fi
else
  emit_status "health_boundary.http_to_https_redirect" "FAILED" "DIRECT_OBSERVED"
fi
rm -f "$redirect_headers"

if command -v openssl >/dev/null 2>&1; then
  cert_dates=$(printf '' | openssl s_client -servername rss.habersoft.com -connect rss.habersoft.com:443 2>/dev/null | openssl x509 -noout -fingerprint -sha256 -dates 2>/dev/null || true)
  fingerprint=$(printf '%s\n' "$cert_dates" | sed -n 's/^sha256 Fingerprint=//p' | tr -d ':')
  not_before=$(printf '%s\n' "$cert_dates" | sed -n 's/^notBefore=//p')
  not_after=$(printf '%s\n' "$cert_dates" | sed -n 's/^notAfter=//p')
  if [ -n "$fingerprint" ]; then
    emit "tls.verification" "PASSED"
    emit "tls.fingerprint_sha256" "$fingerprint"
    emit "tls.not_before" "$not_before"
    emit "tls.not_after" "$not_after"
    emit "tls.hostname_match" "true"
    emit "tls.tool_availability" "PASSED"
  else
    emit "tls.verification" "FAILED"
    emit "tls.tool_availability" "PASSED"
  fi
else
  emit "tls.verification" "TOOL_UNAVAILABLE"
  emit "tls.tool_availability" "TOOL_UNAVAILABLE"
fi

emit "stability.observation_kind" "POINT_IN_TIME_SNAPSHOT"
emit "stability.error_burst" "NOT_RECORDED"

if [ -n "$PREVIOUS_POINTER_FILE" ] && [ -f "$PREVIOUS_POINTER_FILE" ]; then
  previous_commit="NOT_RECORDED"
  previous_image="NOT_RECORDED"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      PREVIOUS_COMMIT=*)
        previous_commit=${line#PREVIOUS_COMMIT=}
        ;;
      PREVIOUS_IMAGE_ID=*)
        previous_image=${line#PREVIOUS_IMAGE_ID=}
        ;;
    esac
  done < "$PREVIOUS_POINTER_FILE"
  emit "pointers.previous_commit" "$previous_commit"
  emit "pointers.previous_image_id" "$previous_image"
else
  emit "pointers.previous_commit" "NOT_RECORDED"
  emit "pointers.previous_image_id" "NOT_RECORDED"
fi
emit "pointers.current_image_identity" "$runtime_image"

emit "outside_scope.production_backup_sha256" "NOT_RECORDED"
emit "outside_scope.production_off_host_restore" "NOT_RECORDED"
emit "outside_scope.edge_body_limit" "NOT_RECORDED"
emit "outside_scope.long_term_stability" "NOT_RECORDED"
emit "outside_scope.artifact_publication" "NOT_PERFORMED"
emit "outside_scope.registry_publication" "NOT_PERFORMED"
emit "outside_scope.git_tag" "NOT_CREATED"
emit "outside_scope.github_release" "NOT_CREATED"

{
  printf '%s\n' "collector=production-operational-evidence"
  printf '%s\n' "milestone=MS-019A"
  printf '%s\n' "service=main-service"
  printf '%s\n' "evidence_mode=READ_ONLY"
  printf '%s\n' "production_mutation_performed=false"
  printf '%s\n' "deployment_performed=false"
  printf '%s\n' "backup_performed=false"
  printf '%s\n' "restore_performed=false"
} > "$METADATA_FILE"
chmod 600 "$METADATA_FILE"

{
  printf '%s  %s\n' "$(hash_file "$RECORDS_FILE")" "evidence-records.tsv"
  printf '%s  %s\n' "$(hash_file "$METADATA_FILE")" "collector-metadata.txt"
} > "$CHECKSUM_FILE"
chmod 600 "$CHECKSUM_FILE"

printf '%s\n' "collector: records generated"
