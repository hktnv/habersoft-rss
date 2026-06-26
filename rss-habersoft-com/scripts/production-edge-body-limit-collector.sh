#!/usr/bin/env bash
set -euo pipefail

umask 077
export LC_ALL=C

CONTRACT_VERSION="production-edge-body-limit-evidence-v1"
MILESTONE="MS-019E"
SERVICE_NAME="main-service"
CANONICAL_REMOTE="https://github.com/hktnv/habersoft-rss"
SOURCE_COMMIT="${MS019E_SOURCE_COMMIT:-__MS019E_SOURCE_COMMIT__}"

ROUTE="/agent/entries"
METHOD="POST"
CONTENT_TYPE="application/json"
INTERNAL_BASE="http://127.0.0.1:3200"
PUBLIC_BASE="https://rss.habersoft.com"
CONFIRM_PUBLIC_HOST=""
OUTPUT_DIR=""

BODY_LIMIT_BYTES=5242880
SMALL_BODY_BYTES=1024
EXACT_BODY_BYTES=5242880
OVER_BODY_BYTES=5242881
MAX_REQUEST_COUNT=6
USER_AGENT="habersoft-ms019e-edge-body-limit-probe/1"

TMP_DIR=""
REQUEST_COUNT=0
SAFE_STOP_REASON="NONE"

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage:
  production-edge-body-limit-collector.sh \
    --confirm-public-host rss.habersoft.com \
    --output-dir <new-empty-output-dir>

This collector performs at most six sequential unauthenticated request-body
compatibility probes against the pinned internal loopback and public HTTPS
targets. It keeps only checksums, metadata, and tabular evidence records.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --confirm-public-host)
      [ "$#" -ge 2 ] || die "--confirm-public-host requires a value"
      CONFIRM_PUBLIC_HOST="$2"
      shift 2
      ;;
    --output-dir)
      [ "$#" -ge 2 ] || die "--output-dir requires a value"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage
      die "Unknown argument: $1"
      ;;
  esac
done

[ "$CONFIRM_PUBLIC_HOST" = "rss.habersoft.com" ] || die "--confirm-public-host must be rss.habersoft.com"
[ -n "$OUTPUT_DIR" ] || die "--output-dir is required"

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"
command -v wc >/dev/null 2>&1 || die "wc is required"
command -v head >/dev/null 2>&1 || die "head is required"
command -v tr >/dev/null 2>&1 || die "tr is required"
command -v mktemp >/dev/null 2>&1 || die "mktemp is required"

if [ -e "$OUTPUT_DIR" ]; then
  [ -d "$OUTPUT_DIR" ] || die "output path exists and is not a directory"
  if [ -n "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    die "output directory must be empty"
  fi
else
  mkdir -p "$OUTPUT_DIR"
fi
chmod 700 "$OUTPUT_DIR" 2>/dev/null || true

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

RECORDS_FILE="$OUTPUT_DIR/evidence-records.tsv"
METADATA_FILE="$OUTPUT_DIR/collector-metadata.txt"
CHECKSUMS_FILE="$OUTPUT_DIR/checksums.sha256"
: >"$RECORDS_FILE"

sanitize_value() {
  printf '%s' "$1" | tr '\r\n\t' '   '
}

emit_record() {
  local section key value
  section=$(sanitize_value "$1")
  key=$(sanitize_value "$2")
  value=$(sanitize_value "$3")
  printf '%s\t%s\t%s\n' "$section" "$key" "$value" >>"$RECORDS_FILE"
}

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

byte_count() {
  wc -c <"$1" | tr -d ' '
}

make_payload() {
  local target_bytes="$1"
  local output_file="$2"
  local prefix suffix prefix_bytes suffix_bytes fill_bytes actual_bytes
  prefix='{"probe":"'
  suffix='"}'
  prefix_bytes=$(printf '%s' "$prefix" | wc -c | tr -d ' ')
  suffix_bytes=$(printf '%s' "$suffix" | wc -c | tr -d ' ')
  fill_bytes=$((target_bytes - prefix_bytes - suffix_bytes))
  [ "$fill_bytes" -ge 0 ] || die "payload target is smaller than fixed JSON envelope"
  {
    printf '%s' "$prefix"
    head -c "$fill_bytes" /dev/zero | tr '\000' 'a'
    printf '%s' "$suffix"
  } >"$output_file"
  actual_bytes=$(byte_count "$output_file")
  [ "$actual_bytes" = "$target_bytes" ] || die "payload byte mismatch for $target_bytes"
}

curl_exit_class() {
  case "$1" in
    0) printf 'OK' ;;
    28) printf 'TIMEOUT' ;;
    35|52|56) printf 'CONNECTION_CLOSED_OR_TRANSPORT_ERROR' ;;
    60) printf 'TLS_VERIFY_FAILED' ;;
    *) printf 'CURL_EXIT_%s' "$1" ;;
  esac
}

tls_result() {
  local target_class="$1"
  local curl_code="$2"
  local ssl_verify="$3"
  if [ "$target_class" = "INTERNAL_LOOPBACK" ]; then
    printf 'NOT_APPLICABLE'
    return
  fi
  if [ "$curl_code" = "60" ]; then
    printf 'FAILED'
    return
  fi
  if [ "$curl_code" = "0" ] && { [ "$ssl_verify" = "0" ] || [ "$ssl_verify" = "" ]; }; then
    printf 'PASSED'
    return
  fi
  printf 'NOT_RECORDED'
}

run_probe() {
  local probe_class="$1"
  local target_class="$2"
  local requested_bytes="$3"
  local expected_status="$4"
  local url="$5"
  local payload_file="$6"
  local section response_file metrics_file error_file metrics curl_code http_status uploaded_bytes ssl_verify http_version generated_bytes exit_class tls_class upload_match status_match

  section="probe.${probe_class}.${target_class}"
  generated_bytes=$(byte_count "$payload_file")
  [ "$generated_bytes" = "$requested_bytes" ] || die "generated payload byte mismatch before network"
  REQUEST_COUNT=$((REQUEST_COUNT + 1))
  [ "$REQUEST_COUNT" -le "$MAX_REQUEST_COUNT" ] || die "request count exceeded max"

  response_file="$TMP_DIR/${probe_class}.${target_class}.body"
  metrics_file="$TMP_DIR/${probe_class}.${target_class}.metrics"
  error_file="$TMP_DIR/${probe_class}.${target_class}.err"

  set +e
  metrics=$(
    (
      unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy NO_PROXY no_proxy
      curl -q --silent --show-error \
        --output "$response_file" \
        --write-out '%{http_code}\t%{size_upload}\t%{ssl_verify_result}\t%{http_version}' \
        --request "$METHOD" \
        --connect-timeout 10 \
        --max-time 90 \
        --header "Content-Type: application/json" \
        --header "Expect:" \
        --user-agent "$USER_AGENT" \
        --data-binary @"$payload_file" \
        "$url"
    ) 2>"$error_file"
  )
  curl_code=$?
  set -e
  printf '%s' "$metrics" >"$metrics_file"

  http_status=$(printf '%s' "$metrics" | awk -F '\t' '{print $1}')
  uploaded_bytes=$(printf '%s' "$metrics" | awk -F '\t' '{print $2}')
  ssl_verify=$(printf '%s' "$metrics" | awk -F '\t' '{print $3}')
  http_version=$(printf '%s' "$metrics" | awk -F '\t' '{print $4}')
  [ -n "$http_status" ] || http_status="000"
  [ -n "$uploaded_bytes" ] || uploaded_bytes="0"
  uploaded_bytes=${uploaded_bytes%%.*}
  exit_class=$(curl_exit_class "$curl_code")
  tls_class=$(tls_result "$target_class" "$curl_code" "$ssl_verify")
  if [ "$uploaded_bytes" = "$requested_bytes" ]; then
    upload_match="true"
  else
    upload_match="false"
  fi
  if [ "$curl_code" = "0" ] && [ "$http_status" = "$expected_status" ]; then
    status_match="true"
  else
    status_match="false"
  fi

  emit_record "$section" "probe_class" "$probe_class"
  emit_record "$section" "target_class" "$target_class"
  emit_record "$section" "method" "$METHOD"
  emit_record "$section" "route" "$ROUTE"
  emit_record "$section" "content_type" "$CONTENT_TYPE"
  emit_record "$section" "requested_bytes" "$requested_bytes"
  emit_record "$section" "generated_bytes" "$generated_bytes"
  emit_record "$section" "uploaded_bytes" "$uploaded_bytes"
  emit_record "$section" "upload_bytes_match" "$upload_match"
  emit_record "$section" "curl_exit_code" "$curl_code"
  emit_record "$section" "curl_exit_class" "$exit_class"
  emit_record "$section" "http_status" "$http_status"
  emit_record "$section" "expected_http_status" "$expected_status"
  emit_record "$section" "http_status_match" "$status_match"
  emit_record "$section" "tls_verification" "$tls_class"
  emit_record "$section" "ssl_verify_result" "${ssl_verify:-NOT_RECORDED}"
  emit_record "$section" "http_version" "${http_version:-NOT_RECORDED}"
  emit_record "$section" "auth_credential_used" "false"
  emit_record "$section" "cookies_used" "false"
  emit_record "$section" "retry_used" "false"
  emit_record "$section" "mutation" "false"
  rm -f "$response_file" "$metrics_file" "$error_file"
}

small_payload="$TMP_DIR/small.json"
exact_payload="$TMP_DIR/exact.json"
over_payload="$TMP_DIR/over.json"
make_payload "$SMALL_BODY_BYTES" "$small_payload"
make_payload "$EXACT_BODY_BYTES" "$exact_payload"
make_payload "$OVER_BODY_BYTES" "$over_payload"

run_probe "CONTROL_SMALL" "INTERNAL_LOOPBACK" "$SMALL_BODY_BYTES" "401" "${INTERNAL_BASE}${ROUTE}" "$small_payload"
if ! awk -F '\t' '$1=="probe.CONTROL_SMALL.INTERNAL_LOOPBACK" && $2=="http_status_match" && $3=="true" {found=1} END {exit found ? 0 : 1}' "$RECORDS_FILE"; then
  SAFE_STOP_REASON="INTERNAL_SMALL_FAILED"
else
  run_probe "CONTROL_SMALL" "PUBLIC_HTTPS" "$SMALL_BODY_BYTES" "401" "${PUBLIC_BASE}${ROUTE}" "$small_payload"
  if ! awk -F '\t' '$1=="probe.CONTROL_SMALL.PUBLIC_HTTPS" && $2=="http_status_match" && $3=="true" {found=1} END {exit found ? 0 : 1}' "$RECORDS_FILE"; then
    SAFE_STOP_REASON="PUBLIC_SMALL_FAILED"
  else
    run_probe "EXACT_LIMIT" "INTERNAL_LOOPBACK" "$EXACT_BODY_BYTES" "401" "${INTERNAL_BASE}${ROUTE}" "$exact_payload"
    if ! awk -F '\t' '$1=="probe.EXACT_LIMIT.INTERNAL_LOOPBACK" && $2=="http_status_match" && $3=="true" {found=1} END {exit found ? 0 : 1}' "$RECORDS_FILE"; then
      SAFE_STOP_REASON="INTERNAL_EXACT_FAILED"
    else
      run_probe "EXACT_LIMIT" "PUBLIC_HTTPS" "$EXACT_BODY_BYTES" "401" "${PUBLIC_BASE}${ROUTE}" "$exact_payload"
      run_probe "LIMIT_PLUS_ONE" "INTERNAL_LOOPBACK" "$OVER_BODY_BYTES" "413" "${INTERNAL_BASE}${ROUTE}" "$over_payload"
      run_probe "LIMIT_PLUS_ONE" "PUBLIC_HTTPS" "$OVER_BODY_BYTES" "413" "${PUBLIC_BASE}${ROUTE}" "$over_payload"
    fi
  fi
fi

{
  printf 'collector=production-edge-body-limit-collector\n'
  printf 'milestone=%s\n' "$MILESTONE"
  printf 'service=%s\n' "$SERVICE_NAME"
  printf 'contract_version=%s\n' "$CONTRACT_VERSION"
  printf 'canonical_remote=%s\n' "$CANONICAL_REMOTE"
  printf 'source_commit=%s\n' "$SOURCE_COMMIT"
  printf 'collector_sha256=%s\n' "$(sha256_file "$0")"
  printf 'collection_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'route=%s\n' "$ROUTE"
  printf 'method=%s\n' "$METHOD"
  printf 'content_type=%s\n' "$CONTENT_TYPE"
  printf 'body_limit_bytes=%s\n' "$BODY_LIMIT_BYTES"
  printf 'small_body_bytes=%s\n' "$SMALL_BODY_BYTES"
  printf 'exact_body_bytes=%s\n' "$EXACT_BODY_BYTES"
  printf 'over_body_bytes=%s\n' "$OVER_BODY_BYTES"
  printf 'max_request_count=%s\n' "$MAX_REQUEST_COUNT"
  printf 'actual_request_count=%s\n' "$REQUEST_COUNT"
  printf 'canonical_public_host=rss.habersoft.com\n'
  printf 'internal_base_class=INTERNAL_LOOPBACK\n'
  printf 'public_base_class=PUBLIC_HTTPS\n'
  printf 'auth_credential_used=false\n'
  printf 'cookies=false\n'
  printf 'retries=false\n'
  printf 'concurrency=1\n'
  printf 'payload_retained=false\n'
  printf 'response_retained=false\n'
  printf 'headers_retained=false\n'
  printf 'mutation=false\n'
  printf 'safe_stop_reason=%s\n' "$SAFE_STOP_REASON"
} >"$METADATA_FILE"

{
  printf '%s  %s\n' "$(sha256_file "$METADATA_FILE")" "collector-metadata.txt"
  printf '%s  %s\n' "$(sha256_file "$RECORDS_FILE")" "evidence-records.tsv"
} >"$CHECKSUMS_FILE"

printf 'Wrote production edge body-limit evidence to %s\n' "$OUTPUT_DIR"
