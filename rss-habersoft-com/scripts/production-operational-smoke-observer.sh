#!/usr/bin/env bash
set -eu
set -o pipefail

umask 077

CONTRACT_VERSION="production-operational-smoke-evidence-v2"
MILESTONE="MS-019F"
SERVICE="main-service"
ENVIRONMENT="production"
APPLICATION_VERSION="0.1.0-ms-017"
CANONICAL_REMOTE="https://github.com/hktnv/habersoft-rss"
SOURCE_COMMIT="__MS019F_SOURCE_COMMIT__"

WINDOW_SECONDS=1200
WINDOW_MINUTES=20
PRIMARY_INTERVAL_SECONDS=60
PRIMARY_SAMPLE_COUNT=21
WORKER_INTERVAL_SECONDS=300
WORKER_SAMPLE_COUNT=5
ERROR_BUCKET_SECONDS=60
ERROR_BUCKET_COUNT=20
MAX_SAMPLE_LAG_SECONDS=15
PUBLIC_HOST="rss.habersoft.com"
INTERNAL_BASE_URL="http://127.0.0.1:3200"
PUBLIC_BASE_URL="https://rss.habersoft.com"
CLASSIFIER_MODE="STABLE_SEVERITY_PREFIX"
CLASSIFIER_VERSION="production-log-severity-prefix-v1"

usage() {
  printf '%s\n' "usage: observe-production-operational-smoke.sh --repository-dir <production-repository-root> --compose-file <production-compose> --shared-env <production-shared-env> --runtime-image-env <runtime-image-env> --confirm-window-minutes 20 --confirm-public-host rss.habersoft.com --output-dir <new-empty-output-dir>" >&2
  exit 2
}

fail() {
  printf 'observer: %s\n' "$1" >&2
  exit 1
}

REPOSITORY_DIR=
COMPOSE_FILE=
SHARED_ENV_FILE=
RUNTIME_IMAGE_ENV_FILE=
OUTPUT_DIR=
CONFIRM_WINDOW_MINUTES=
CONFIRM_PUBLIC_HOST=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository-dir)
      [ "$#" -ge 2 ] || usage
      REPOSITORY_DIR=$2
      shift 2
      ;;
    --compose-file)
      [ "$#" -ge 2 ] || usage
      COMPOSE_FILE=$2
      shift 2
      ;;
    --shared-env)
      [ "$#" -ge 2 ] || usage
      SHARED_ENV_FILE=$2
      shift 2
      ;;
    --runtime-image-env)
      [ "$#" -ge 2 ] || usage
      RUNTIME_IMAGE_ENV_FILE=$2
      shift 2
      ;;
    --confirm-window-minutes)
      [ "$#" -ge 2 ] || usage
      CONFIRM_WINDOW_MINUTES=$2
      shift 2
      ;;
    --confirm-public-host)
      [ "$#" -ge 2 ] || usage
      CONFIRM_PUBLIC_HOST=$2
      shift 2
      ;;
    --output-dir)
      [ "$#" -ge 2 ] || usage
      OUTPUT_DIR=$2
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[ -n "$REPOSITORY_DIR" ] || usage
[ -n "$COMPOSE_FILE" ] || usage
[ -n "$SHARED_ENV_FILE" ] || usage
[ -n "$RUNTIME_IMAGE_ENV_FILE" ] || usage
[ -n "$OUTPUT_DIR" ] || usage
[ "$CONFIRM_WINDOW_MINUTES" = "20" ] || fail "confirm-window-minutes must be 20"
[ "$CONFIRM_PUBLIC_HOST" = "$PUBLIC_HOST" ] || fail "confirm-public-host must be rss.habersoft.com"

case "$OUTPUT_DIR" in
  /*) ;;
  *) fail "output-dir must be absolute" ;;
esac

REPO_ROOT=$(git -C "$REPOSITORY_DIR" rev-parse --show-toplevel 2>/dev/null || printf '')
if [ -z "$REPO_ROOT" ] && [ "${MS019F_TEST_MODE:-0}" = "1" ]; then
  REPO_ROOT=$REPOSITORY_DIR
fi
[ -n "$REPO_ROOT" ] || fail "repository root could not be resolved"

if [ -f "$REPO_ROOT/backend/package.json" ]; then
  BACKEND_DIR="$REPO_ROOT/backend"
else
  BACKEND_DIR="$REPO_ROOT"
fi

resolve_backend_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$BACKEND_DIR/$1" ;;
  esac
}

COMPOSE_FILE=$(resolve_backend_path "$COMPOSE_FILE")
SHARED_ENV_FILE=$(resolve_backend_path "$SHARED_ENV_FILE")
RUNTIME_IMAGE_ENV_FILE=$(resolve_backend_path "$RUNTIME_IMAGE_ENV_FILE")

[ -f "$BACKEND_DIR/package.json" ] || fail "main-service package.json not found"
[ -f "$COMPOSE_FILE" ] || fail "production compose file not found"
if [ "${MS019F_TEST_MODE:-0}" != "1" ]; then
  [ -f "$SHARED_ENV_FILE" ] || fail "shared env file not found"
  [ -f "$RUNTIME_IMAGE_ENV_FILE" ] || fail "runtime image env file not found"
fi
if [ "${MS019F_TEST_MODE:-0}" != "1" ]; then
  [ "$(git -C "$BACKEND_DIR" remote get-url origin 2>/dev/null | sed 's/\.git$//')" = "$CANONICAL_REMOTE" ] || fail "canonical remote mismatch"
fi

if [ -e "$OUTPUT_DIR" ]; then
  [ -d "$OUTPUT_DIR" ] || fail "output-dir exists and is not a directory"
  [ "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = "0" ] || fail "output-dir must be empty"
else
  mkdir -p "$OUTPUT_DIR"
fi
chmod 700 "$OUTPUT_DIR"

PARENT_DIR=$(dirname "$OUTPUT_DIR")
WORK_DIR="$PARENT_DIR/.production-operational-smoke-observer.$$"
if [ -e "$WORK_DIR" ]; then
  fail "temporary work directory already exists"
fi
mkdir -p "$WORK_DIR"
chmod 700 "$WORK_DIR"
printf '%s\n' "IN_PROGRESS" > "$WORK_DIR/IN_PROGRESS"

METADATA_FILE="$WORK_DIR/collector-metadata.txt"
SAMPLES_FILE="$WORK_DIR/operational-smoke-samples.tsv"
BUCKETS_FILE="$WORK_DIR/error-signal-buckets.tsv"
CHECKSUM_FILE="$WORK_DIR/checksums.sha256"

cleanup_on_exit() {
  status=$?
  if [ "$status" -ne 0 ]; then
    printf 'observer: incomplete run has no valid final checksum bundle\n' >&2
  fi
  exit "$status"
}
trap cleanup_on_exit EXIT

utc_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

utc_from_epoch() {
  date -u -d "@$1" +"%Y-%m-%dT%H:%M:%SZ"
}

epoch_now() {
  date -u +"%s"
}

monotonic_seconds() {
  if [ -r /proc/uptime ]; then
    awk '{print int($1)}' /proc/uptime
  else
    date -u +"%s"
  fi
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

hash_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

compose_cmd() {
  docker compose --env-file "$SHARED_ENV_FILE" --env-file "$RUNTIME_IMAGE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

inspect_field() {
  docker inspect --format "$2" "$1" 2>/dev/null || printf 'NOT_RECORDED'
}

safe_bool() {
  case "$1" in
    true|false) printf '%s\n' "$1" ;;
    *) printf 'false\n' ;;
  esac
}

write_metadata() {
  key=$1
  value=$2
  safe_value=$(printf '%s' "$value" | tr '\r\n\t' '   ')
  printf '%s=%s\n' "$key" "$safe_value" >> "$METADATA_FILE"
}

classify_health_body() {
  file=$1
  expected_status=$2
  if [ "$expected_status" = "live" ]; then
    grep -q '"status"[[:space:]]*:[[:space:]]*"live"' "$file"
    return
  fi
  grep -q '"status"[[:space:]]*:[[:space:]]*"ready"' "$file" &&
    grep -q '"postgres"[[:space:]]*:[[:space:]]*"up"' "$file" &&
    grep -q '"redis"[[:space:]]*:[[:space:]]*"up"' "$file" &&
    grep -q '"tenantAuth"[[:space:]]*:[[:space:]]*"up"' "$file"
}

probe_health() {
  url=$1
  expected_status=$2
  tls_required=$3
  body_file=$(mktemp "$WORK_DIR/health.XXXXXX")
  metrics_file=$(mktemp "$WORK_DIR/metrics.XXXXXX")
  if curl -q --silent --show-error --max-time 10 --max-redirs 0 --output "$body_file" --write-out '%{http_code}\t%{ssl_verify_result}' "$url" > "$metrics_file" 2>/dev/null; then
    curl_exit=0
  else
    curl_exit=$?
  fi
  metrics=$(cat "$metrics_file")
  rm -f "$metrics_file"
  http_code=$(printf '%s' "$metrics" | awk -F '\t' '{print $1}')
  ssl_verify=$(printf '%s' "$metrics" | awk -F '\t' '{print $2}')
  [ -n "$http_code" ] || http_code=000
  [ -n "$ssl_verify" ] || ssl_verify=NOT_RECORDED
  if [ "$curl_exit" -eq 0 ] && [ "$http_code" = "200" ] && classify_health_body "$body_file" "$expected_status"; then
    health_result=PASSED
  else
    health_result=FAILED
  fi
  if [ "$tls_required" = "true" ]; then
    if [ "$curl_exit" -eq 0 ] && [ "$ssl_verify" = "0" ]; then
      tls_result=PASSED
    else
      tls_result=FAILED
    fi
  else
    tls_result=NOT_APPLICABLE
  fi
  rm -f "$body_file"
  printf '%s\t%s\t%s\n' "$health_result" "$http_code" "$tls_result"
}

container_state() {
  cid=$1
  initial_token=$2
  initial_image=$3
  initial_restart=$4
  initial_started=$5
  role=$6
  current_id=$(inspect_field "$cid" '{{.Id}}')
  current_token=$(hash_text "$current_id")
  current_image=$(inspect_field "$cid" '{{.Image}}')
  current_state=$(inspect_field "$cid" '{{.State.Status}}')
  current_restart=$(inspect_field "$cid" '{{.RestartCount}}')
  current_oom=$(inspect_field "$cid" '{{.State.OOMKilled}}')
  current_started=$(inspect_field "$cid" '{{.State.StartedAt}}')
  if [ "$current_state" != "running" ]; then
    printf '%s\n' "CONTAINER_NOT_RUNNING"
  elif [ "$current_token" != "$initial_token" ]; then
    printf '%s\n' "${role}_CONTAINER_REPLACED"
  elif [ "$current_image" != "$initial_image" ]; then
    printf '%s\n' "IMAGE_ID_CHANGED"
  elif [ "$current_restart" != "$initial_restart" ] || [ "$current_started" != "$initial_started" ]; then
    printf '%s\n' "${role}_RESTART_DETECTED"
  elif [ "$current_oom" != "false" ]; then
    printf '%s\n' "${role}_OOM_DETECTED"
  else
    printf '%s\n' "PASSED"
  fi
}

worker_health_sample() {
  output_file=$(mktemp "$WORK_DIR/worker.XXXXXX")
  if compose_cmd exec -T main-service-worker npm run worker:health > "$output_file" 2>&1; then
    worker_exit=0
  else
    worker_exit=$?
  fi
  if [ "$worker_exit" -eq 0 ] &&
    grep -q '"postgres"[[:space:]]*:[[:space:]]*"up"' "$output_file" &&
    grep -q '"redis"[[:space:]]*:[[:space:]]*"up"' "$output_file" &&
    grep -q '"queue"[[:space:]]*:[[:space:]]*"main-service.maintenance"' "$output_file" &&
    grep -q '"scheduler_id"[[:space:]]*:[[:space:]]*"cleanup.daily"' "$output_file" &&
    grep -q '"global_concurrency"[[:space:]]*:[[:space:]]*1' "$output_file"; then
    result=PASSED
  else
    result=FAILED
  fi
  rm -f "$output_file"
  printf '%s\n' "$result"
}

classify_log_stream() {
  awk '
    BEGIN { warn=0; err=0; fatal=0; unsupported=0 }
    {
      line=$0
      gsub(/\033\[[0-9;]*m/, "", line)
      if (line ~ /^\[Nest\][[:space:]]+[0-9]+[[:space:]]+-[[:space:]].*[[:space:]]FATAL([[:space:]]|$)/) { fatal++; next }
      if (line ~ /^\[Nest\][[:space:]]+[0-9]+[[:space:]]+-[[:space:]].*[[:space:]]ERROR([[:space:]]|$)/) { err++; next }
      if (line ~ /^\[Nest\][[:space:]]+[0-9]+[[:space:]]+-[[:space:]].*[[:space:]]WARN([[:space:]]|$)/) { warn++; next }
      if (line ~ /^main-service-(api|worker|worker-health) bootstrap failed$/) { err++; next }
      if (line ~ /^Invalid runtime configuration:/) { err++; next }
      if (line ~ /^tenant auth JWKS refresh failed: /) { warn++; next }
      if (line ~ /^\{.*"operation":"cleanup_step".*"status":"failed".*\}$/) { warn++; next }
      if (line ~ /^\{.*"signal":"cleanup_step_failed\{step=[a-z_]+\}".*\}$/) { warn++; next }
    }
    END { printf "%d\t%d\t%d\t%d\n", warn, err, fatal, unsupported }
  '
}

log_bucket() {
  bucket_index=$1
  service_name=$2
  cid=$3
  start_utc=$4
  end_utc=$5
  counts_file=$(mktemp "$WORK_DIR/logcounts.XXXXXX")
  if docker logs --since "$start_utc" --until "$end_utc" "$cid" 2>&1 | classify_log_stream > "$counts_file"; then
    exit_class=OK
    coverage=true
  else
    exit_class=LOG_SIGNAL_COLLECTION_FAILED
    coverage=false
  fi
  counts=$(cat "$counts_file")
  rm -f "$counts_file"
  warning_count=$(printf '%s' "$counts" | awk -F '\t' '{print $1}')
  error_count=$(printf '%s' "$counts" | awk -F '\t' '{print $2}')
  fatal_count=$(printf '%s' "$counts" | awk -F '\t' '{print $3}')
  unsupported_count=$(printf '%s' "$counts" | awk -F '\t' '{print $4}')
  [ -n "$warning_count" ] || warning_count=0
  [ -n "$error_count" ] || error_count=0
  [ -n "$fatal_count" ] || fatal_count=0
  [ -n "$unsupported_count" ] || unsupported_count=0
  if [ "$coverage" = "true" ] && [ "$unsupported_count" = "0" ]; then
    safe_result=PASSED
  else
    safe_result=LOG_SIGNAL_COLLECTION_FAILED
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$bucket_index" "$service_name" "$start_utc" "$end_utc" "$CLASSIFIER_MODE" \
    "$warning_count" "$error_count" "$fatal_count" "$exit_class" "$coverage" "$safe_result" >> "$BUCKETS_FILE"
}

write_test_bundle() {
  variant=${MS019F_TEST_VARIANT:-success}
  start_epoch=1782900000
  start_utc=$(utc_from_epoch "$start_epoch")
  end_epoch=$((start_epoch + WINDOW_SECONDS))
  end_utc=$(utc_from_epoch "$end_epoch")
  api_token=$(hash_text "api-test-container")
  worker_token=$(hash_text "worker-test-container")
  printf 'sample_index\ttarget_elapsed_seconds\tcollected_utc\tscheduling_lag_seconds\tinternal_live_result\tinternal_ready_result\tpublic_live_result\tpublic_ready_result\tdependencies_result\ttls_result\tapi_container_result\tworker_container_result\tcompose_context_result\tworker_health_due\tworker_health_result\tsafe_result\tblocker\n' > "$SAMPLES_FILE"
  printf 'bucket_index\tservice\tstart_utc\tend_utc\tclassifier_mode\twarning_count\terror_count\tfatal_count\tcollection_exit_class\tcoverage_complete\tsafe_result\n' > "$BUCKETS_FILE"
  for i in $(seq 0 20); do
    lag=0
    internal_live=PASSED
    internal_ready=PASSED
    public_live=PASSED
    public_ready=PASSED
    dependencies=PASSED
    tls=PASSED
    api_container=PASSED
    worker_container=PASSED
    worker_due=false
    worker_result=NOT_DUE
    safe=PASSED
    blocker=NONE
    if [ $((i % 5)) -eq 0 ]; then
      worker_due=true
      worker_result=PASSED
    fi
    if [ "$variant" = "health" ] && [ "$i" -eq 7 ]; then
      public_ready=FAILED
      safe=FAILED
      blocker=BLOCKED_PUBLIC_HEALTH_FAILURE
    fi
    if [ "$variant" = "restart" ] && [ "$i" -eq 9 ]; then
      api_container=API_RESTART_DETECTED
      safe=FAILED
      blocker=BLOCKED_CONTAINER_RESTART
    fi
    if [ "$variant" = "lag" ] && [ "$i" -eq 3 ]; then
      lag=16
      safe=FAILED
      blocker=BLOCKED_SCHEDULING_LAG
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$i" "$((i * PRIMARY_INTERVAL_SECONDS))" "$(utc_from_epoch $((start_epoch + i * PRIMARY_INTERVAL_SECONDS)))" "$lag" \
      "$internal_live" "$internal_ready" "$public_live" "$public_ready" "$dependencies" "$tls" \
      "$api_container" "$worker_container" PASSED "$worker_due" "$worker_result" "$safe" "$blocker" >> "$SAMPLES_FILE"
  done
  for i in $(seq 0 19); do
    bucket_start=$(utc_from_epoch $((start_epoch + i * ERROR_BUCKET_SECONDS)))
    bucket_end=$(utc_from_epoch $((start_epoch + (i + 1) * ERROR_BUCKET_SECONDS)))
    for service_name in api worker; do
      warn=0
      err=0
      fatal=0
      coverage=true
      exit_class=OK
      safe=PASSED
      if [ "$variant" = "error" ] && [ "$i" -eq 5 ] && [ "$service_name" = "api" ]; then
        err=1
      fi
      if [ "$variant" = "fatal" ] && [ "$i" -eq 6 ] && [ "$service_name" = "worker" ]; then
        fatal=1
      fi
      if [ "$variant" = "loggap" ] && [ "$i" -eq 4 ] && [ "$service_name" = "worker" ]; then
        coverage=false
        exit_class=LOG_SIGNAL_COLLECTION_FAILED
        safe=LOG_SIGNAL_COLLECTION_FAILED
      fi
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$i" "$service_name" "$bucket_start" "$bucket_end" "$CLASSIFIER_MODE" \
        "$warn" "$err" "$fatal" "$exit_class" "$coverage" "$safe" >> "$BUCKETS_FILE"
    done
  done
  if [ "$variant" = "interrupt" ]; then
    fail "test interruption requested"
  fi
  write_metadata "schema_version" "1"
  write_metadata "contract_version" "$CONTRACT_VERSION"
  write_metadata "milestone" "$MILESTONE"
  write_metadata "service" "$SERVICE"
  write_metadata "environment" "$ENVIRONMENT"
  write_metadata "application_version" "$APPLICATION_VERSION"
  write_metadata "canonical_remote" "$CANONICAL_REMOTE"
  write_metadata "source_commit" "$SOURCE_COMMIT"
  write_metadata "collector_sha256" "$(hash_file "$0")"
  write_metadata "started_at_utc" "$start_utc"
  write_metadata "ended_at_utc" "$end_utc"
  write_metadata "elapsed_seconds" "$WINDOW_SECONDS"
  write_metadata "window_class" "BOUNDED_20M_OPERATIONAL_SMOKE"
  write_metadata "window_seconds" "$WINDOW_SECONDS"
  write_metadata "window_minutes" "$WINDOW_MINUTES"
  write_metadata "primary_interval_seconds" "$PRIMARY_INTERVAL_SECONDS"
  write_metadata "primary_sample_count" "$PRIMARY_SAMPLE_COUNT"
  write_metadata "worker_interval_seconds" "$WORKER_INTERVAL_SECONDS"
  write_metadata "worker_sample_count" "$WORKER_SAMPLE_COUNT"
  write_metadata "error_bucket_seconds" "$ERROR_BUCKET_SECONDS"
  write_metadata "error_bucket_count" "$ERROR_BUCKET_COUNT"
  write_metadata "max_sample_lag_seconds" "$MAX_SAMPLE_LAG_SECONDS"
  write_metadata "long_term_stability_claim" "false"
  write_metadata "long_term_stability_status" "NOT_APPLICABLE_BY_GOVERNANCE_DECISION"
  write_metadata "compose_context_class" "TEST_FIXTURE"
  write_metadata "api_initial_identity_token" "$api_token"
  write_metadata "worker_initial_identity_token" "$worker_token"
  write_metadata "api_initial_image_id" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  write_metadata "worker_initial_image_id" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  write_metadata "api_initial_restart_count" "0"
  write_metadata "worker_initial_restart_count" "0"
  write_metadata "api_initial_started_at" "$start_utc"
  write_metadata "worker_initial_started_at" "$start_utc"
  write_metadata "log_classifier_mode" "$CLASSIFIER_MODE"
  write_metadata "log_classifier_version" "$CLASSIFIER_VERSION"
  write_metadata "docker_log_driver_class" "TEST_FIXTURE"
  write_metadata "raw_logs_retained" "false"
  write_metadata "raw_health_retained" "false"
  write_metadata "auth_credentials_used" "false"
  write_metadata "retry" "false"
  write_metadata "concurrency" "1"
  write_metadata "production_mutation" "false"
  write_metadata "deployment_performed" "false"
  write_metadata "restart_performed" "false"
  write_metadata "migration_performed" "false"
  write_metadata "backup_performed" "false"
  write_metadata "restore_performed" "false"
}

if [ "${MS019F_TEST_MODE:-0}" = "1" ]; then
  write_test_bundle
else
  compose_cmd config --services >/dev/null 2>&1 || fail "production Compose context failed"
  api_cid=$(compose_cmd ps -q main-service-api 2>/dev/null || true)
  worker_cid=$(compose_cmd ps -q main-service-worker 2>/dev/null || true)
  [ -n "$api_cid" ] || fail "API container not found"
  [ -n "$worker_cid" ] || fail "worker container not found"
  api_initial_id=$(inspect_field "$api_cid" '{{.Id}}')
  worker_initial_id=$(inspect_field "$worker_cid" '{{.Id}}')
  api_initial_token=$(hash_text "$api_initial_id")
  worker_initial_token=$(hash_text "$worker_initial_id")
  api_initial_image=$(inspect_field "$api_cid" '{{.Image}}')
  worker_initial_image=$(inspect_field "$worker_cid" '{{.Image}}')
  api_initial_restart=$(inspect_field "$api_cid" '{{.RestartCount}}')
  worker_initial_restart=$(inspect_field "$worker_cid" '{{.RestartCount}}')
  api_initial_started=$(inspect_field "$api_cid" '{{.State.StartedAt}}')
  worker_initial_started=$(inspect_field "$worker_cid" '{{.State.StartedAt}}')
  api_log_driver=$(inspect_field "$api_cid" '{{.HostConfig.LogConfig.Type}}')
  worker_log_driver=$(inspect_field "$worker_cid" '{{.HostConfig.LogConfig.Type}}')
  case "$api_log_driver:$worker_log_driver" in
    json-file:json-file) log_driver_class=DOCKER_JSON_FILE ;;
    local:local) log_driver_class=DOCKER_LOCAL ;;
    *) fail "unsupported Docker log driver" ;;
  esac

  start_epoch=$(epoch_now)
  start_mono=$(monotonic_seconds)
  start_utc=$(utc_from_epoch "$start_epoch")
  printf 'sample_index\ttarget_elapsed_seconds\tcollected_utc\tscheduling_lag_seconds\tinternal_live_result\tinternal_ready_result\tpublic_live_result\tpublic_ready_result\tdependencies_result\ttls_result\tapi_container_result\tworker_container_result\tcompose_context_result\tworker_health_due\tworker_health_result\tsafe_result\tblocker\n' > "$SAMPLES_FILE"
  printf 'bucket_index\tservice\tstart_utc\tend_utc\tclassifier_mode\twarning_count\terror_count\tfatal_count\tcollection_exit_class\tcoverage_complete\tsafe_result\n' > "$BUCKETS_FILE"
  previous_sample_utc=
  for i in $(seq 0 20); do
    target=$((start_mono + i * PRIMARY_INTERVAL_SECONDS))
    now_mono=$(monotonic_seconds)
    if [ "$now_mono" -lt "$target" ]; then
      sleep $((target - now_mono))
    fi
    collected_epoch=$(epoch_now)
    collected_utc=$(utc_from_epoch "$collected_epoch")
    now_mono=$(monotonic_seconds)
    lag=$((now_mono - target))
    [ "$lag" -ge 0 ] || lag=0

    internal_live=$(probe_health "$INTERNAL_BASE_URL/health/live" live false)
    internal_ready=$(probe_health "$INTERNAL_BASE_URL/health/ready" ready false)
    public_live=$(probe_health "$PUBLIC_BASE_URL/health/live" live true)
    public_ready=$(probe_health "$PUBLIC_BASE_URL/health/ready" ready true)
    internal_live_result=$(printf '%s' "$internal_live" | awk -F '\t' '{print $1}')
    internal_ready_result=$(printf '%s' "$internal_ready" | awk -F '\t' '{print $1}')
    public_live_result=$(printf '%s' "$public_live" | awk -F '\t' '{print $1}')
    public_ready_result=$(printf '%s' "$public_ready" | awk -F '\t' '{print $1}')
    public_live_tls=$(printf '%s' "$public_live" | awk -F '\t' '{print $3}')
    public_ready_tls=$(printf '%s' "$public_ready" | awk -F '\t' '{print $3}')
    if [ "$internal_ready_result" = "PASSED" ] && [ "$public_ready_result" = "PASSED" ]; then
      dependencies_result=PASSED
    else
      dependencies_result=FAILED
    fi
    if [ "$public_live_tls" = "PASSED" ] && [ "$public_ready_tls" = "PASSED" ]; then
      tls_result=PASSED
    else
      tls_result=FAILED
    fi
    api_container_result=$(container_state "$api_cid" "$api_initial_token" "$api_initial_image" "$api_initial_restart" "$api_initial_started" API)
    worker_container_result=$(container_state "$worker_cid" "$worker_initial_token" "$worker_initial_image" "$worker_initial_restart" "$worker_initial_started" WORKER)
    worker_due=false
    worker_result=NOT_DUE
    if [ $((i % 5)) -eq 0 ]; then
      worker_due=true
      worker_result=$(worker_health_sample)
    fi
    safe_result=PASSED
    blocker=NONE
    if [ "$lag" -gt "$MAX_SAMPLE_LAG_SECONDS" ]; then
      safe_result=FAILED
      blocker=BLOCKED_SCHEDULING_LAG
    elif [ "$internal_live_result" != "PASSED" ] || [ "$internal_ready_result" != "PASSED" ]; then
      safe_result=FAILED
      blocker=BLOCKED_HEALTH_SAMPLE_FAILURE
    elif [ "$public_live_result" != "PASSED" ] || [ "$public_ready_result" != "PASSED" ]; then
      safe_result=FAILED
      blocker=BLOCKED_PUBLIC_HEALTH_FAILURE
    elif [ "$dependencies_result" != "PASSED" ]; then
      safe_result=FAILED
      blocker=BLOCKED_DEPENDENCY_READINESS
    elif [ "$tls_result" != "PASSED" ]; then
      safe_result=FAILED
      blocker=BLOCKED_PUBLIC_HEALTH_FAILURE
    elif [ "$api_container_result" != "PASSED" ]; then
      safe_result=FAILED
      blocker="$api_container_result"
    elif [ "$worker_container_result" != "PASSED" ]; then
      safe_result=FAILED
      blocker="$worker_container_result"
    elif [ "$worker_due" = "true" ] && [ "$worker_result" != "PASSED" ]; then
      safe_result=FAILED
      blocker=BLOCKED_WORKER_HEALTH
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$i" "$((i * PRIMARY_INTERVAL_SECONDS))" "$collected_utc" "$lag" \
      "$internal_live_result" "$internal_ready_result" "$public_live_result" "$public_ready_result" \
      "$dependencies_result" "$tls_result" "$api_container_result" "$worker_container_result" \
      PASSED "$worker_due" "$worker_result" "$safe_result" "$blocker" >> "$SAMPLES_FILE"
    if [ "$i" -gt 0 ]; then
      bucket_index=$((i - 1))
      log_bucket "$bucket_index" api "$api_cid" "$previous_sample_utc" "$collected_utc"
      log_bucket "$bucket_index" worker "$worker_cid" "$previous_sample_utc" "$collected_utc"
    fi
    previous_sample_utc=$collected_utc
  done
  end_epoch=$(epoch_now)
  end_utc=$(utc_from_epoch "$end_epoch")
  elapsed=$((end_epoch - start_epoch))
  write_metadata "schema_version" "1"
  write_metadata "contract_version" "$CONTRACT_VERSION"
  write_metadata "milestone" "$MILESTONE"
  write_metadata "service" "$SERVICE"
  write_metadata "environment" "$ENVIRONMENT"
  write_metadata "application_version" "$APPLICATION_VERSION"
  write_metadata "canonical_remote" "$CANONICAL_REMOTE"
  write_metadata "source_commit" "$SOURCE_COMMIT"
  write_metadata "collector_sha256" "$(hash_file "$0")"
  write_metadata "started_at_utc" "$start_utc"
  write_metadata "ended_at_utc" "$end_utc"
  write_metadata "elapsed_seconds" "$elapsed"
  write_metadata "window_class" "BOUNDED_20M_OPERATIONAL_SMOKE"
  write_metadata "window_seconds" "$WINDOW_SECONDS"
  write_metadata "window_minutes" "$WINDOW_MINUTES"
  write_metadata "primary_interval_seconds" "$PRIMARY_INTERVAL_SECONDS"
  write_metadata "primary_sample_count" "$PRIMARY_SAMPLE_COUNT"
  write_metadata "worker_interval_seconds" "$WORKER_INTERVAL_SECONDS"
  write_metadata "worker_sample_count" "$WORKER_SAMPLE_COUNT"
  write_metadata "error_bucket_seconds" "$ERROR_BUCKET_SECONDS"
  write_metadata "error_bucket_count" "$ERROR_BUCKET_COUNT"
  write_metadata "max_sample_lag_seconds" "$MAX_SAMPLE_LAG_SECONDS"
  write_metadata "long_term_stability_claim" "false"
  write_metadata "long_term_stability_status" "NOT_APPLICABLE_BY_GOVERNANCE_DECISION"
  write_metadata "compose_context_class" "EXPLICIT_PRODUCTION_COMPOSE_TWO_ENV_FILES"
  write_metadata "api_initial_identity_token" "$api_initial_token"
  write_metadata "worker_initial_identity_token" "$worker_initial_token"
  write_metadata "api_initial_image_id" "$api_initial_image"
  write_metadata "worker_initial_image_id" "$worker_initial_image"
  write_metadata "api_initial_restart_count" "$api_initial_restart"
  write_metadata "worker_initial_restart_count" "$worker_initial_restart"
  write_metadata "api_initial_started_at" "$api_initial_started"
  write_metadata "worker_initial_started_at" "$worker_initial_started"
  write_metadata "log_classifier_mode" "$CLASSIFIER_MODE"
  write_metadata "log_classifier_version" "$CLASSIFIER_VERSION"
  write_metadata "docker_log_driver_class" "$log_driver_class"
  write_metadata "raw_logs_retained" "false"
  write_metadata "raw_health_retained" "false"
  write_metadata "auth_credentials_used" "false"
  write_metadata "retry" "false"
  write_metadata "concurrency" "1"
  write_metadata "production_mutation" "false"
  write_metadata "deployment_performed" "false"
  write_metadata "restart_performed" "false"
  write_metadata "migration_performed" "false"
  write_metadata "backup_performed" "false"
  write_metadata "restore_performed" "false"
fi

rm -f "$WORK_DIR/IN_PROGRESS"
for file in collector-metadata.txt operational-smoke-samples.tsv error-signal-buckets.tsv; do
  chmod 600 "$WORK_DIR/$file"
done
{
  printf '%s  collector-metadata.txt\n' "$(hash_file "$METADATA_FILE")"
  printf '%s  operational-smoke-samples.tsv\n' "$(hash_file "$SAMPLES_FILE")"
  printf '%s  error-signal-buckets.tsv\n' "$(hash_file "$BUCKETS_FILE")"
} > "$CHECKSUM_FILE"
chmod 600 "$CHECKSUM_FILE"

mv "$METADATA_FILE" "$OUTPUT_DIR/collector-metadata.txt"
mv "$SAMPLES_FILE" "$OUTPUT_DIR/operational-smoke-samples.tsv"
mv "$BUCKETS_FILE" "$OUTPUT_DIR/error-signal-buckets.tsv"
mv "$CHECKSUM_FILE" "$OUTPUT_DIR/checksums.sha256"
rmdir "$WORK_DIR"
trap - EXIT
printf '%s\n' "observer: completed bounded operational smoke bundle"
