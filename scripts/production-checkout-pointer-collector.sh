#!/usr/bin/env bash
set -euo pipefail

umask 077

CONTRACT_VERSION="production-checkout-pointer-evidence-v1"
MILESTONE="MS-019D"
SERVICE_NAME="main-service"
CANONICAL_REMOTE="https://github.com/hktnv/habersoft-rss"
SOURCE_COMMIT="${MS019D_SOURCE_COMMIT:-__MS019D_SOURCE_COMMIT__}"

REPOSITORY_DIR=""
COMPOSE_FILE=""
SHARED_ENV=""
RUNTIME_IMAGE_ENV=""
OUTPUT_DIR=""
PREVIOUS_POINTER_FILE=""

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage:
  production-checkout-pointer-collector.sh \
    --repository-dir <path> \
    --compose-file <path> \
    --shared-env <path> \
    --runtime-image-env <path> \
    --output-dir <empty-output-dir> \
    [--previous-pointer-file <path>]

This collector is read-only. It records production checkout hygiene, current
runtime image pointer identity, and optional previous rollback pointer evidence.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository-dir)
      [ "$#" -ge 2 ] || die "--repository-dir requires a value"
      REPOSITORY_DIR="$2"
      shift 2
      ;;
    --compose-file)
      [ "$#" -ge 2 ] || die "--compose-file requires a value"
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --shared-env)
      [ "$#" -ge 2 ] || die "--shared-env requires a value"
      SHARED_ENV="$2"
      shift 2
      ;;
    --runtime-image-env)
      [ "$#" -ge 2 ] || die "--runtime-image-env requires a value"
      RUNTIME_IMAGE_ENV="$2"
      shift 2
      ;;
    --output-dir)
      [ "$#" -ge 2 ] || die "--output-dir requires a value"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --previous-pointer-file)
      [ "$#" -ge 2 ] || die "--previous-pointer-file requires a value"
      PREVIOUS_POINTER_FILE="$2"
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

[ -n "$REPOSITORY_DIR" ] || die "--repository-dir is required"
[ -n "$COMPOSE_FILE" ] || die "--compose-file is required"
[ -n "$SHARED_ENV" ] || die "--shared-env is required"
[ -n "$RUNTIME_IMAGE_ENV" ] || die "--runtime-image-env is required"
[ -n "$OUTPUT_DIR" ] || die "--output-dir is required"

command -v git >/dev/null 2>&1 || die "git is required"
command -v docker >/dev/null 2>&1 || die "docker is required"

if ! REPO_ROOT=$(git -C "$REPOSITORY_DIR" rev-parse --show-toplevel 2>/dev/null); then
  die "repository-dir must be inside a Git checkout"
fi

resolve_under_repo() {
  local value="$1"
  case "$value" in
    /*) printf '%s\n' "$value" ;;
    *) printf '%s/%s\n' "$REPO_ROOT" "$value" ;;
  esac
}

COMPOSE_FILE_PATH=$(resolve_under_repo "$COMPOSE_FILE")
SHARED_ENV_PATH=$(resolve_under_repo "$SHARED_ENV")
RUNTIME_IMAGE_ENV_PATH=$(resolve_under_repo "$RUNTIME_IMAGE_ENV")

[ -f "$COMPOSE_FILE_PATH" ] || die "compose file must be a regular file"
[ -f "$SHARED_ENV_PATH" ] || die "shared env file must be a regular file"
[ -f "$RUNTIME_IMAGE_ENV_PATH" ] || die "runtime image env file must be a regular file"

if [ -e "$OUTPUT_DIR" ]; then
  [ -d "$OUTPUT_DIR" ] || die "output path exists and is not a directory"
  if [ -n "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    die "output directory must be empty"
  fi
else
  mkdir -p "$OUTPUT_DIR"
fi
chmod 700 "$OUTPUT_DIR" 2>/dev/null || true

RECORDS_FILE="$OUTPUT_DIR/evidence-records.tsv"
METADATA_FILE="$OUTPUT_DIR/collector-metadata.txt"
CHECKSUMS_FILE="$OUTPUT_DIR/checksums.sha256"

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

write_metadata() {
  {
    printf 'collector=production-checkout-pointer-collector\n'
    printf 'milestone=%s\n' "$MILESTONE"
    printf 'service=%s\n' "$SERVICE_NAME"
    printf 'contract_version=%s\n' "$CONTRACT_VERSION"
    printf 'canonical_remote=%s\n' "$CANONICAL_REMOTE"
    printf 'source_commit=%s\n' "$SOURCE_COMMIT"
    printf 'generated_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'read_only=true\n'
    printf 'production_mutation=false\n'
  } >"$METADATA_FILE"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 -r "$1" | awk '{print $1}'
  else
    die "sha256sum, shasum, or openssl is required"
  fi
}

sha256_string() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    printf '%s' "$1" | openssl dgst -sha256 -r | awk '{print $1}'
  else
    die "sha256sum, shasum, or openssl is required"
  fi
}

bool_file_exists() {
  if [ -e "$1" ]; then
    printf 'true'
  else
    printf 'false'
  fi
}

git_bool_success() {
  if git -C "$REPO_ROOT" "$@" >/dev/null 2>&1; then
    printf 'true'
  else
    printf 'false'
  fi
}

docker_capture() {
  docker "$@" 2>/dev/null
}

docker_compose_capture() {
  docker compose --env-file "$SHARED_ENV_PATH" --env-file "$RUNTIME_IMAGE_ENV_PATH" -f "$COMPOSE_FILE_PATH" "$@" 2>/dev/null
}

parse_runtime_image_env() {
  local line value found
  found="false"
  value=""
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      MAIN_SERVICE_IMAGE=*)
        if [ "$found" = "true" ]; then
          emit_record "runtime" "image_env_parse_status" "DUPLICATE_MAIN_SERVICE_IMAGE"
          printf '\n'
          return 1
        fi
        found="true"
        value=${line#MAIN_SERVICE_IMAGE=}
        ;;
    esac
  done <"$RUNTIME_IMAGE_ENV_PATH"
  if [ "$found" != "true" ] || [ -z "$value" ]; then
    emit_record "runtime" "image_env_parse_status" "MISSING_MAIN_SERVICE_IMAGE"
    printf '\n'
    return 1
  fi
  case "$value" in
    *[[:space:]]*|*\"*|*\'*|*\`*|*\$*|*\(*|*\)*)
      emit_record "runtime" "image_env_parse_status" "INVALID_MAIN_SERVICE_IMAGE"
      printf '\n'
      return 1
      ;;
  esac
  emit_record "runtime" "image_env_parse_status" "OK"
  printf '%s\n' "$value"
}

write_metadata
: >"$RECORDS_FILE"

emit_record "bundle" "milestone" "$MILESTONE"
emit_record "bundle" "service" "$SERVICE_NAME"
emit_record "bundle" "contract_version" "$CONTRACT_VERSION"
emit_record "bundle" "collector_source_commit" "$SOURCE_COMMIT"

REMOTE_URL=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || printf '')
HEAD_COMMIT=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || printf '')
ORIGIN_MAIN_COMMIT=$(git -C "$REPO_ROOT" rev-parse refs/remotes/origin/main 2>/dev/null || printf '')
BRANCH_NAME=$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'DETACHED_HEAD')
GIT_DIR=$(git -C "$REPO_ROOT" rev-parse --git-dir 2>/dev/null || printf '')
case "$GIT_DIR" in
  /*) ;;
  *) GIT_DIR="$REPO_ROOT/$GIT_DIR" ;;
esac

emit_record "git" "remote_url" "$REMOTE_URL"
emit_record "git" "canonical_remote_expected" "$CANONICAL_REMOTE"
emit_record "git" "head_commit" "$HEAD_COMMIT"
emit_record "git" "origin_main_commit" "$ORIGIN_MAIN_COMMIT"
emit_record "git" "branch_name" "$BRANCH_NAME"
emit_record "git" "head_is_origin_main" "$(if [ -n "$HEAD_COMMIT" ] && [ "$HEAD_COMMIT" = "$ORIGIN_MAIN_COMMIT" ]; then printf 'true'; else printf 'false'; fi)"
emit_record "git" "head_reachable_from_origin_main" "$(if [ -n "$HEAD_COMMIT" ] && git -C "$REPO_ROOT" merge-base --is-ancestor "$HEAD_COMMIT" refs/remotes/origin/main >/dev/null 2>&1; then printf 'true'; else printf 'false'; fi)"
emit_record "git" "is_shallow_repository" "$(git -C "$REPO_ROOT" rev-parse --is-shallow-repository 2>/dev/null || printf 'unknown')"
emit_record "git" "merge_in_progress" "$(bool_file_exists "$GIT_DIR/MERGE_HEAD")"
emit_record "git" "cherry_pick_in_progress" "$(bool_file_exists "$GIT_DIR/CHERRY_PICK_HEAD")"
emit_record "git" "revert_in_progress" "$(bool_file_exists "$GIT_DIR/REVERT_HEAD")"
emit_record "git" "rebase_apply_in_progress" "$(bool_file_exists "$GIT_DIR/rebase-apply")"
emit_record "git" "rebase_merge_in_progress" "$(bool_file_exists "$GIT_DIR/rebase-merge")"

TRACKED_INDEX_CHANGE_COUNT=0
TRACKED_WORKTREE_CHANGE_COUNT=0
TRACKED_DELETION_COUNT=0
UNMERGED_COUNT=0
UNKNOWN_UNTRACKED_COUNT=0
ALLOWLISTED_EXTERNAL_STATE_UNTRACKED_COUNT=0
UNKNOWN_UNTRACKED_HASHES=""

while IFS= read -r status_line || [ -n "$status_line" ]; do
  case "$status_line" in
    "1 "*|"2 "*)
      xy=${status_line#? }
      xy=${xy%% *}
      x=${xy%?}
      y=${xy#?}
      if [ "$x" != "." ]; then
        TRACKED_INDEX_CHANGE_COUNT=$((TRACKED_INDEX_CHANGE_COUNT + 1))
      fi
      if [ "$y" != "." ]; then
        TRACKED_WORKTREE_CHANGE_COUNT=$((TRACKED_WORKTREE_CHANGE_COUNT + 1))
      fi
      if [ "$x" = "D" ] || [ "$y" = "D" ]; then
        TRACKED_DELETION_COUNT=$((TRACKED_DELETION_COUNT + 1))
      fi
      ;;
    "u "*)
      UNMERGED_COUNT=$((UNMERGED_COUNT + 1))
      ;;
    "? "*)
      path=${status_line#"? "}
      case "$path" in
        operator-state/*|*/operator-state/*)
          ALLOWLISTED_EXTERNAL_STATE_UNTRACKED_COUNT=$((ALLOWLISTED_EXTERNAL_STATE_UNTRACKED_COUNT + 1))
          ;;
        *)
          UNKNOWN_UNTRACKED_COUNT=$((UNKNOWN_UNTRACKED_COUNT + 1))
          path_hash=$(sha256_string "$path")
          if [ -z "$UNKNOWN_UNTRACKED_HASHES" ]; then
            UNKNOWN_UNTRACKED_HASHES="$path_hash"
          else
            UNKNOWN_UNTRACKED_HASHES="$UNKNOWN_UNTRACKED_HASHES,$path_hash"
          fi
          ;;
      esac
      ;;
  esac
done <<EOF
$(git -C "$REPO_ROOT" status --porcelain=v2 --untracked-files=all 2>/dev/null || true)
EOF

OPERATOR_STATE_IGNORED=$(git_bool_success check-ignore operator-state/ms-019d/__probe__)
DEPLOY_RUNTIME_IMAGE_IGNORED=$(git_bool_success check-ignore deploy/runtime-image.env)
ENV_PRODUCTION_IGNORED=$(git_bool_success check-ignore .env.production)
OVERBROAD_SRC_IGNORE=$(git_bool_success check-ignore src/__ms019d_ignore_probe__.ts)
OVERBROAD_SCRIPT_IGNORE=$(git_bool_success check-ignore scripts/__ms019d_ignore_probe__.mjs)
OVERBROAD_PRISMA_IGNORE=$(git_bool_success check-ignore prisma/__ms019d_ignore_probe__.prisma)

emit_record "checkout" "tracked_index_change_count" "$TRACKED_INDEX_CHANGE_COUNT"
emit_record "checkout" "tracked_worktree_change_count" "$TRACKED_WORKTREE_CHANGE_COUNT"
emit_record "checkout" "tracked_deletion_count" "$TRACKED_DELETION_COUNT"
emit_record "checkout" "unmerged_count" "$UNMERGED_COUNT"
emit_record "checkout" "unknown_untracked_count" "$UNKNOWN_UNTRACKED_COUNT"
emit_record "checkout" "unknown_untracked_path_hashes" "$UNKNOWN_UNTRACKED_HASHES"
emit_record "checkout" "allowlisted_external_state_untracked_count" "$ALLOWLISTED_EXTERNAL_STATE_UNTRACKED_COUNT"
emit_record "checkout" "operator_state_ignore_policy_present" "$OPERATOR_STATE_IGNORED"
emit_record "checkout" "deploy_runtime_image_ignore_policy_present" "$DEPLOY_RUNTIME_IMAGE_IGNORED"
emit_record "checkout" "env_production_ignore_policy_present" "$ENV_PRODUCTION_IGNORED"
emit_record "checkout" "overbroad_source_ignore_detected" "$(if [ "$OVERBROAD_SRC_IGNORE" = "true" ] || [ "$OVERBROAD_SCRIPT_IGNORE" = "true" ] || [ "$OVERBROAD_PRISMA_IGNORE" = "true" ]; then printf 'true'; else printf 'false'; fi)"

if [ "$(bool_file_exists "$GIT_DIR/MERGE_HEAD")" = "true" ] || [ "$(bool_file_exists "$GIT_DIR/rebase-apply")" = "true" ] || [ "$(bool_file_exists "$GIT_DIR/rebase-merge")" = "true" ]; then
  CHECKOUT_CLASSIFICATION="GIT_OPERATION_IN_PROGRESS"
elif [ "$BRANCH_NAME" = "DETACHED_HEAD" ]; then
  CHECKOUT_CLASSIFICATION="DETACHED_HEAD"
elif [ "$BRANCH_NAME" != "main" ]; then
  CHECKOUT_CLASSIFICATION="WRONG_BRANCH"
elif [ "$UNMERGED_COUNT" -gt 0 ]; then
  CHECKOUT_CLASSIFICATION="UNMERGED_CONFLICTS"
elif [ "$TRACKED_DELETION_COUNT" -gt 0 ]; then
  CHECKOUT_CLASSIFICATION="TRACKED_DELETED"
elif [ "$TRACKED_INDEX_CHANGE_COUNT" -gt 0 ]; then
  CHECKOUT_CLASSIFICATION="TRACKED_INDEX_MODIFIED"
elif [ "$TRACKED_WORKTREE_CHANGE_COUNT" -gt 0 ]; then
  CHECKOUT_CLASSIFICATION="TRACKED_WORKTREE_MODIFIED"
elif [ "$UNKNOWN_UNTRACKED_COUNT" -gt 0 ]; then
  CHECKOUT_CLASSIFICATION="UNTRACKED_UNKNOWN"
elif [ "$ALLOWLISTED_EXTERNAL_STATE_UNTRACKED_COUNT" -gt 0 ]; then
  CHECKOUT_CLASSIFICATION="ALLOWLISTED_EXTERNAL_STATE_UNTRACKED"
elif [ "$OPERATOR_STATE_IGNORED" = "true" ] && [ "$DEPLOY_RUNTIME_IMAGE_IGNORED" = "true" ] && [ "$ENV_PRODUCTION_IGNORED" = "true" ]; then
  CHECKOUT_CLASSIFICATION="ALLOWLISTED_EXTERNAL_STATE_IGNORED"
else
  CHECKOUT_CLASSIFICATION="CLEAN"
fi

emit_record "checkout" "classification" "$CHECKOUT_CLASSIFICATION"

RUNTIME_IMAGE=$(parse_runtime_image_env || true)
emit_record "runtime" "main_service_image" "$RUNTIME_IMAGE"

if docker_compose_capture config --services >/dev/null; then
  emit_record "compose" "config_services_status" "OK"
else
  emit_record "compose" "config_services_status" "FAILED"
fi

API_CONTAINER_ID=$(docker_compose_capture ps -q main-service-api || true)
WORKER_CONTAINER_ID=$(docker_compose_capture ps -q main-service-worker || true)
emit_record "runtime" "api_container_present" "$(if [ -n "$API_CONTAINER_ID" ]; then printf 'true'; else printf 'false'; fi)"
emit_record "runtime" "worker_container_present" "$(if [ -n "$WORKER_CONTAINER_ID" ]; then printf 'true'; else printf 'false'; fi)"

API_IMAGE_ID=""
WORKER_IMAGE_ID=""
RUNTIME_IMAGE_ID=""
CURRENT_IMAGE_REVISION=""
CURRENT_IMAGE_SOURCE=""

if [ -n "$API_CONTAINER_ID" ]; then
  API_IMAGE_ID=$(docker_capture inspect --format '{{.Image}}' "$API_CONTAINER_ID" || true)
fi
if [ -n "$WORKER_CONTAINER_ID" ]; then
  WORKER_IMAGE_ID=$(docker_capture inspect --format '{{.Image}}' "$WORKER_CONTAINER_ID" || true)
fi
if [ -n "$RUNTIME_IMAGE" ]; then
  RUNTIME_IMAGE_ID=$(docker_capture image inspect "$RUNTIME_IMAGE" --format '{{.Id}}' || true)
  CURRENT_IMAGE_REVISION=$(docker_capture image inspect "$RUNTIME_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' || true)
  CURRENT_IMAGE_SOURCE=$(docker_capture image inspect "$RUNTIME_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.source"}}' || true)
fi

emit_record "current_pointer" "api_image_id" "$API_IMAGE_ID"
emit_record "current_pointer" "worker_image_id" "$WORKER_IMAGE_ID"
emit_record "current_pointer" "runtime_image_id" "$RUNTIME_IMAGE_ID"
emit_record "current_pointer" "image_revision" "$CURRENT_IMAGE_REVISION"
emit_record "current_pointer" "image_source" "$CURRENT_IMAGE_SOURCE"
emit_record "current_pointer" "api_worker_image_match" "$(if [ -n "$API_IMAGE_ID" ] && [ "$API_IMAGE_ID" = "$WORKER_IMAGE_ID" ]; then printf 'true'; else printf 'false'; fi)"
emit_record "current_pointer" "runtime_image_matches_api" "$(if [ -n "$RUNTIME_IMAGE_ID" ] && [ "$RUNTIME_IMAGE_ID" = "$API_IMAGE_ID" ]; then printf 'true'; else printf 'false'; fi)"
emit_record "current_pointer" "revision_exists_in_checkout" "$(if [ -n "$CURRENT_IMAGE_REVISION" ]; then git_bool_success cat-file -e "$CURRENT_IMAGE_REVISION^{commit}"; else printf 'false'; fi)"
emit_record "current_pointer" "revision_reachable_from_origin_main" "$(if [ -n "$CURRENT_IMAGE_REVISION" ]; then git_bool_success merge-base --is-ancestor "$CURRENT_IMAGE_REVISION" refs/remotes/origin/main; else printf 'false'; fi)"
emit_record "current_pointer" "revision_matches_checkout_head" "$(if [ -n "$CURRENT_IMAGE_REVISION" ] && [ "$CURRENT_IMAGE_REVISION" = "$HEAD_COMMIT" ]; then printf 'true'; else printf 'false'; fi)"

parse_previous_pointer_file() {
  local file="$1"
  local line previous_commit previous_image_id version_seen commit_seen image_seen
  previous_commit=""
  previous_image_id=""
  version_seen="false"
  commit_seen="false"
  image_seen="false"
  [ -f "$file" ] || {
    emit_record "previous_pointer" "source_status" "POINTER_FILE_NOT_REGULAR"
    return 1
  }
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "")
        ;;
      POINTER_CONTRACT_VERSION=production-release-pointer-state-v1)
        if [ "$version_seen" = "true" ]; then
          emit_record "previous_pointer" "source_status" "POINTER_FILE_DUPLICATE_KEY"
          return 1
        fi
        version_seen="true"
        ;;
      PREVIOUS_COMMIT=*)
        if [ "$commit_seen" = "true" ]; then
          emit_record "previous_pointer" "source_status" "POINTER_FILE_DUPLICATE_KEY"
          return 1
        fi
        previous_commit=${line#PREVIOUS_COMMIT=}
        commit_seen="true"
        ;;
      PREVIOUS_IMAGE_ID=*)
        if [ "$image_seen" = "true" ]; then
          emit_record "previous_pointer" "source_status" "POINTER_FILE_DUPLICATE_KEY"
          return 1
        fi
        previous_image_id=${line#PREVIOUS_IMAGE_ID=}
        image_seen="true"
        ;;
      *)
        emit_record "previous_pointer" "source_status" "POINTER_FILE_UNKNOWN_KEY"
        return 1
        ;;
    esac
  done <"$file"

  if [[ ! "$previous_commit" =~ ^[0-9a-f]{40}$ ]]; then
    emit_record "previous_pointer" "source_status" "POINTER_FILE_INVALID_PREVIOUS_COMMIT"
    return 1
  fi
  if [[ ! "$previous_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    emit_record "previous_pointer" "source_status" "POINTER_FILE_INVALID_PREVIOUS_IMAGE_ID"
    return 1
  fi

  emit_record "previous_pointer" "source_status" "STRICT_POINTER_FILE"
  emit_record "previous_pointer" "commit" "$previous_commit"
  emit_record "previous_pointer" "image_id" "$previous_image_id"
  return 0
}

PREVIOUS_RESULT="PREVIOUS_POINTER_NOT_RECORDED"
if [ -z "$PREVIOUS_POINTER_FILE" ]; then
  emit_record "previous_pointer" "source_status" "NOT_RECORDED"
  emit_record "previous_pointer" "verification_result" "$PREVIOUS_RESULT"
else
  case "$PREVIOUS_POINTER_FILE" in
    /*) PREVIOUS_POINTER_PATH="$PREVIOUS_POINTER_FILE" ;;
    *) PREVIOUS_POINTER_PATH="$REPO_ROOT/$PREVIOUS_POINTER_FILE" ;;
  esac
  if parse_previous_pointer_file "$PREVIOUS_POINTER_PATH"; then
    PREVIOUS_COMMIT_VALUE=$(awk -F '\t' '$1=="previous_pointer" && $2=="commit" {print $3}' "$RECORDS_FILE" | tail -n 1)
    PREVIOUS_IMAGE_ID_VALUE=$(awk -F '\t' '$1=="previous_pointer" && $2=="image_id" {print $3}' "$RECORDS_FILE" | tail -n 1)
    PREVIOUS_IMAGE_REVISION=$(docker_capture image inspect "$PREVIOUS_IMAGE_ID_VALUE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' || true)
    PREVIOUS_IMAGE_SOURCE=$(docker_capture image inspect "$PREVIOUS_IMAGE_ID_VALUE" --format '{{index .Config.Labels "org.opencontainers.image.source"}}' || true)
    emit_record "previous_pointer" "image_revision" "$PREVIOUS_IMAGE_REVISION"
    emit_record "previous_pointer" "image_source" "$PREVIOUS_IMAGE_SOURCE"
    emit_record "previous_pointer" "commit_exists_in_checkout" "$(git_bool_success cat-file -e "$PREVIOUS_COMMIT_VALUE^{commit}")"
    emit_record "previous_pointer" "commit_reachable_from_origin_main" "$(git_bool_success merge-base --is-ancestor "$PREVIOUS_COMMIT_VALUE" refs/remotes/origin/main)"
    emit_record "previous_pointer" "image_revision_matches_commit" "$(if [ "$PREVIOUS_IMAGE_REVISION" = "$PREVIOUS_COMMIT_VALUE" ]; then printf 'true'; else printf 'false'; fi)"
    emit_record "previous_pointer" "image_differs_from_current" "$(if [ -n "$RUNTIME_IMAGE_ID" ] && [ "$PREVIOUS_IMAGE_ID_VALUE" != "$RUNTIME_IMAGE_ID" ]; then printf 'true'; else printf 'false'; fi)"
    if [ "$(git_bool_success cat-file -e "$PREVIOUS_COMMIT_VALUE^{commit}")" = "true" ] &&
      [ "$(git_bool_success merge-base --is-ancestor "$PREVIOUS_COMMIT_VALUE" refs/remotes/origin/main)" = "true" ] &&
      [ "$PREVIOUS_IMAGE_REVISION" = "$PREVIOUS_COMMIT_VALUE" ] &&
      [ -n "$PREVIOUS_IMAGE_SOURCE" ] &&
      [ "$PREVIOUS_IMAGE_ID_VALUE" != "$RUNTIME_IMAGE_ID" ]; then
      PREVIOUS_RESULT="VERIFIED"
    else
      PREVIOUS_RESULT="BLOCKED"
    fi
    emit_record "previous_pointer" "verification_result" "$PREVIOUS_RESULT"
  else
    emit_record "previous_pointer" "verification_result" "BLOCKED"
  fi
fi

{
  printf '%s  %s\n' "$(sha256_file "$METADATA_FILE")" "collector-metadata.txt"
  printf '%s  %s\n' "$(sha256_file "$RECORDS_FILE")" "evidence-records.tsv"
} >"$CHECKSUMS_FILE"

printf 'Wrote read-only checkout pointer evidence to %s\n' "$OUTPUT_DIR"
