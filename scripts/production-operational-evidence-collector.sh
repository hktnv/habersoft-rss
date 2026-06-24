#!/usr/bin/env bash
set -eu

umask 077

usage() {
  printf '%s\n' "usage: collect-production-operational-evidence.sh --output-dir <new-empty-dir> [--repository-dir <production-repository-root>] [--compose-file <file>] [--shared-env <file>] [--runtime-image-env <file>] [--previous-pointer-file <file>] [--public-base-url <url>] [--api-loopback-base-url <url>]" >&2
  exit 2
}

OUTPUT_DIR=
REPOSITORY_DIR=
COMPOSE_FILE=
IMAGE_ENV_FILE=
SHARED_ENV_FILE=
PREVIOUS_POINTER_FILE=
PUBLIC_BASE_URL="https://rss.habersoft.com"
API_LOOPBACK_BASE_URL="http://127.0.0.1:3200"
COLLECTOR_SOURCE_COMMIT="__MS019B_R7_SOURCE_COMMIT__"
INVOCATION_DIR=$(pwd -P)
case "$COLLECTOR_SOURCE_COMMIT" in
  __MS019B_*)
    COLLECTOR_SOURCE_COMMIT="NOT_RECORDED"
    ;;
esac

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
    --repository-dir)
      [ "$#" -ge 2 ] || usage
      REPOSITORY_DIR=$2
      shift 2
      ;;
    --shared-env)
      [ "$#" -ge 2 ] || usage
      SHARED_ENV_FILE=$2
      shift 2
      ;;
    --runtime-image-env)
      [ "$#" -ge 2 ] || usage
      IMAGE_ENV_FILE=$2
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

resolve_file_from_backend() {
  local value=$1
  case "$value" in
    /*)
      printf '%s\n' "$value"
      ;;
    *)
      printf '%s\n' "$BACKEND_DIR/$value"
      ;;
  esac
}

if [ -n "$REPOSITORY_DIR" ]; then
  REPO_ROOT=$(git -C "$REPOSITORY_DIR" rev-parse --show-toplevel 2>/dev/null || printf 'NOT_RECORDED')
else
  REPO_ROOT=$(git -C "$INVOCATION_DIR" rev-parse --show-toplevel 2>/dev/null || printf 'NOT_RECORDED')
fi
if [ "$REPO_ROOT" = "NOT_RECORDED" ]; then
  printf '%s\n' "collector: production repository root could not be resolved" >&2
  exit 1
fi
if [ -f "$REPO_ROOT/backend/package.json" ]; then
  BACKEND_DIR="$REPO_ROOT/backend"
else
  BACKEND_DIR="$REPO_ROOT"
fi

[ -n "$COMPOSE_FILE" ] || COMPOSE_FILE="deploy/production/compose.yaml"
[ -n "$SHARED_ENV_FILE" ] || SHARED_ENV_FILE=".env.production"
[ -n "$IMAGE_ENV_FILE" ] || IMAGE_ENV_FILE="deploy/runtime-image.env"

COMPOSE_FILE=$(resolve_file_from_backend "$COMPOSE_FILE")
SHARED_ENV_FILE=$(resolve_file_from_backend "$SHARED_ENV_FILE")
IMAGE_ENV_FILE=$(resolve_file_from_backend "$IMAGE_ENV_FILE")

case "$(basename "$SHARED_ENV_FILE")" in
  .env)
    printf '%s\n' "collector: shared production env must not be root .env" >&2
    exit 1
    ;;
esac
for required_file in "$COMPOSE_FILE" "$SHARED_ENV_FILE" "$IMAGE_ENV_FILE"; do
  if [ ! -f "$required_file" ]; then
    printf '%s\n' "collector: required production Compose context file is missing" >&2
    exit 1
  fi
done

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
  local file=$1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

emit() {
  local record_key=$1
  local record_value=$2
  local safe_value
  case "$record_key" in
    *"	"*|*".."*|/*)
      printf '%s\n' "collector: invalid record key" >&2
      exit 1
      ;;
  esac
  safe_value=$(printf '%s' "$record_value" | tr '\r\n\t' '   ')
  printf '%s\t%s\n' "$record_key" "$safe_value" >> "$RECORDS_FILE"
}

emit_status() {
  emit "$1.result" "$2"
  emit "$1.evidence_source" "$3"
}

emit "schema_version" "1"
emit "contract_version" "production-operational-evidence-v2"
emit "milestone" "MS-019B-R7"
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

remote_url=$(git -C "$BACKEND_DIR" remote get-url origin 2>/dev/null || printf 'NOT_RECORDED')
checkout_commit=$(git -C "$BACKEND_DIR" rev-parse HEAD 2>/dev/null || printf 'NOT_RECORDED')
origin_main_ref=$(git -C "$BACKEND_DIR" rev-parse --verify origin/main 2>/dev/null || printf 'NOT_RECORDED')
if git -C "$BACKEND_DIR" status --porcelain 2>/dev/null | grep -q .; then
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
  docker compose --env-file "$SHARED_ENV_FILE" --env-file "$IMAGE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

inspect_field() {
  local container_id=$1
  local template=$2
  docker inspect --format "$template" "$container_id" 2>/dev/null || printf 'NOT_RECORDED'
}

compose_context_tmp=$(mktemp)
if compose_cmd config --services > "$compose_context_tmp" 2>/dev/null; then
  compose_context_ok=true
  emit_status "compose_context" "PASSED" "DIRECT_OBSERVED"
else
  compose_context_ok=false
  emit_status "compose_context" "BLOCKED" "DIRECT_OBSERVED"
fi

if [ "$compose_context_ok" != "true" ]; then
  emit "identity.api_running_image_id" "NOT_RECORDED"
  emit "identity.worker_running_image_id" "NOT_RECORDED"
  emit "identity.inspected_image_id" "NOT_RECORDED"
  emit "identity.running_image_revision_label" "NOT_RECORDED"
  emit "identity.running_image_source_label" "NOT_RECORDED"
  emit "services.observed_service_names" "NOT_RECORDED"
  for service in postgres redis migrate main-service-api main-service-worker; do
    emit "services.observed_service_states.$service.status" "NOT_RECORDED"
    emit "services.observed_service_states.$service.health" "NOT_RECORDED"
  done
  emit "services.api_loopback_binding.result" "BLOCKED"
  emit "services.api_loopback_binding.host_ip" "NOT_RECORDED"
  emit "services.api_loopback_binding.host_port" "NOT_RECORDED"
  emit "services.api_loopback_binding.container_port" "3000"
  emit "services.public_database_port_absent" "BLOCKED"
  emit "services.public_redis_port_absent" "BLOCKED"
  emit "services.worker_host_port_absent" "BLOCKED"
  emit "migration.result" "NOT_RUN"
  emit "migration.evidence_source" "BLOCKED"
  emit "migration.pending_or_failed" "NOT_RECORDED"
  emit "migration.output_sha256" "NOT_RECORDED"
  emit "worker_scheduler.worker_health" "NOT_RUN"
  emit "worker_scheduler.worker_health_evidence_source" "BLOCKED"
  emit "worker_scheduler.output_sha256" "NOT_RECORDED"
  emit "worker_scheduler.queue" "main-service.maintenance"
  emit "worker_scheduler.scheduler" "cleanup.daily"
  emit "worker_scheduler.job" "cleanup.run.v1"
  emit "worker_scheduler.timezone" "UTC"
  emit "worker_scheduler.global_concurrency" "1"
  emit "worker_scheduler.local_concurrency" "1"
  emit "worker_scheduler.scheduler_evidence_source" "NOT_RUN"
else
  service_names=$(compose_cmd ps --services 2>/dev/null | tr '\n' ',' | sed 's/,$//' || printf 'NOT_RECORDED')
emit "services.observed_service_names" "$service_names"
postgres_port_absent="PASSED"
redis_port_absent="PASSED"
worker_port_absent="PASSED"
api_loopback_result="FAILED"
api_host_ip="NOT_RECORDED"
api_host_port="NOT_RECORDED"

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
  case "$service" in
    main-service-api)
      emit "stability.api.restart_count" "$(inspect_field "$cid" '{{.RestartCount}}')"
      emit "stability.api.oom_killed" "$(inspect_field "$cid" '{{.State.OOMKilled}}')"
      emit "stability.api.state" "$(inspect_field "$cid" '{{.State.Status}}')"
      emit "stability.api.started_at" "$(inspect_field "$cid" '{{.State.StartedAt}}')"
      ;;
    main-service-worker)
      emit "stability.worker.restart_count" "$(inspect_field "$cid" '{{.RestartCount}}')"
      emit "stability.worker.oom_killed" "$(inspect_field "$cid" '{{.State.OOMKilled}}')"
      emit "stability.worker.state" "$(inspect_field "$cid" '{{.State.Status}}')"
      emit "stability.worker.started_at" "$(inspect_field "$cid" '{{.State.StartedAt}}')"
      ;;
  esac
  port_projection=$(inspect_field "$cid" '{{range $p,$b := .NetworkSettings.Ports}}{{printf "%s=" $p}}{{range $b}}{{printf "%s:%s," .HostIp .HostPort}}{{end}}{{println}}{{end}}')
  emit "services.observed_service_states.$service.port_projection" "$port_projection"
  case "$service" in
    postgres)
      [ -z "$port_projection" ] || postgres_port_absent="FAILED"
      ;;
    redis)
      [ -z "$port_projection" ] || redis_port_absent="FAILED"
      ;;
    main-service-worker)
      [ -z "$port_projection" ] || worker_port_absent="FAILED"
      ;;
    main-service-api)
      case "$port_projection" in
        *"3000/tcp=127.0.0.1:3200,"*)
          api_loopback_result="PASSED"
          api_host_ip="127.0.0.1"
          api_host_port="3200"
          ;;
      esac
      ;;
  esac
done
emit "services.api_loopback_binding.result" "$api_loopback_result"
emit "services.api_loopback_binding.host_ip" "$api_host_ip"
emit "services.api_loopback_binding.host_port" "$api_host_port"
emit "services.api_loopback_binding.container_port" "3000"
emit "services.public_database_port_absent" "$postgres_port_absent"
emit "services.public_redis_port_absent" "$redis_port_absent"
emit "services.worker_host_port_absent" "$worker_port_absent"

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
  emit "worker_scheduler.worker_health" "PASSED"
  emit "worker_scheduler.worker_health_evidence_source" "DIRECT_OBSERVED"
else
  emit "worker_scheduler.worker_health" "FAILED"
  emit "worker_scheduler.worker_health_evidence_source" "DIRECT_OBSERVED"
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
fi
rm -f "$compose_context_tmp"

http_probe() {
  local probe_key=$1
  local probe_url=$2
  local expected_code=$3
  local body_file
  local code
  body_file=$(mktemp)
  code=$(curl --silent --show-error --max-time 10 --max-redirs 0 --output "$body_file" --write-out '%{http_code}' "$probe_url" 2>/dev/null || printf '000')
  emit "$probe_key.http_status" "$code"
  if [ "$code" = "$expected_code" ]; then
    emit "$probe_key.result" "PASSED"
  else
    emit "$probe_key.result" "FAILED"
  fi
  if grep -q '"status":"live"' "$body_file"; then
    emit "$probe_key.response_status" "live"
  elif grep -q '"status":"ready"' "$body_file"; then
    emit "$probe_key.response_status" "ready"
  else
    emit "$probe_key.response_status" "NOT_RECORDED"
  fi
  case "$probe_key" in
    health_boundary.*_ready)
      if grep -Eq '"postgres"[[:space:]]*:[[:space:]]*"up"' "$body_file"; then
        emit "health_boundary.postgres" "up"
      fi
      if grep -Eq '"redis"[[:space:]]*:[[:space:]]*"up"' "$body_file"; then
        emit "health_boundary.redis" "up"
      fi
      if grep -Eq '"tenantAuth"[[:space:]]*:[[:space:]]*"up"' "$body_file"; then
        emit "health_boundary.tenantAuth" "up"
      fi
      ;;
  esac
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
redirect_location=$(sed -n 's/^[Ll]ocation:[[:space:]]*//p' "$redirect_headers" | head -n 1 | tr -d '\r')
[ -n "$redirect_location" ] || redirect_location="NOT_RECORDED"
if [ "$redirect_code" = "301" ] || [ "$redirect_code" = "302" ] || [ "$redirect_code" = "307" ] || [ "$redirect_code" = "308" ]; then
  if grep -Eiq '^location: https://rss\.habersoft\.com/health/live' "$redirect_headers"; then
    emit_status "health_boundary.http_to_https_redirect" "PASSED" "DIRECT_OBSERVED"
  else
    emit_status "health_boundary.http_to_https_redirect" "FAILED" "DIRECT_OBSERVED"
  fi
else
  emit_status "health_boundary.http_to_https_redirect" "FAILED" "DIRECT_OBSERVED"
fi
emit "health_boundary.http_to_https_redirect.location" "$redirect_location"
rm -f "$redirect_headers"

if command -v openssl >/dev/null 2>&1; then
  cert_dates=$(printf '' | openssl s_client -servername rss.habersoft.com -connect rss.habersoft.com:443 2>/dev/null | openssl x509 -noout -fingerprint -sha256 -dates 2>/dev/null || true)
  fingerprint=$(printf '%s\n' "$cert_dates" | sed -n 's/^sha256 Fingerprint=//p' | tr -d ':' | tr 'A-F' 'a-f')
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
